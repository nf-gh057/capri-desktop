package io.github.nfgh057.capri

import android.app.Activity
import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.os.PowerManager
import android.provider.Settings
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.Signature
import java.util.concurrent.Executors

// Her app: her chat, the one on your desktop, from your phone over Tailscale. Opening it takes your
// fingerprint (her key signs the session's challenge); each order, something she does on your PC, takes
// it again (her key signs that order). Put away, it locks: the session ends, nothing stays open.
class MainActivity : Activity() {
    private val work = Executors.newSingleThreadExecutor()
    private val prefs by lazy { getSharedPreferences("capri", MODE_PRIVATE) }
    private var api: Api? = null
    private var t = JSONObject()           // her words, in her language (from her PC: /api/start)
    @Volatile private var unlocked = false
    private var pending: Pair<String, TextView>? = null // her answer being written: its id, its bubble
    private val notes = mutableListOf<JSONObject>()

    private lateinit var head: TextView
    private lateinit var message: TextView
    private lateinit var action: Button
    private lateinit var chat: LinearLayout
    private lateinit var log: LinearLayout
    private lateinit var scroll: ScrollView
    private lateinit var input: EditText
    private lateinit var order: CheckBox
    private lateinit var send: Button

    private val bg = Color.rgb(11, 10, 15)
    private val red = Color.rgb(255, 95, 86)
    private val yellow = Color.rgb(242, 231, 80)
    private val cyan = Color.rgb(94, 246, 255)
    private val dim = Color.rgb(170, 150, 150)

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        build()
        prefs.getString("origin", null)?.let { api = Api(it) }
        handle(intent)
    }

    override fun onNewIntent(next: Intent) {
        super.onNewIntent(next)
        handle(next)
    }

    override fun onStart() {
        super.onStart()
        Listener.appOpen = true
        if (pairing == null) unlock()
    }

    // put away: locked, the session ended on her PC too
    override fun onStop() {
        super.onStop()
        Listener.appOpen = false
        lock()
    }

    private fun word(key: String, fallback: String) = t.optString(key, fallback).ifEmpty { fallback }

    // --- pairing: her page hands the code over (capri://pair?u=<page>&c=<code>) --------------------------

    private var pairing: Pair<String, String>? = null

    private fun handle(intent: Intent?) {
        val uri: Uri = intent?.data ?: return
        if (uri.scheme != "capri" || uri.host != "pair") return
        val origin = uri.getQueryParameter("u").orEmpty().trimEnd('/')
        val code = uri.getQueryParameter("c").orEmpty()
        // only a page of hers on your Tailscale network: anything else could be anybody's
        if (!Regex("^https://[a-z0-9-]+(\\.[a-z0-9-]+)*\\.ts\\.net:\\d{2,5}$", RegexOption.IGNORE_CASE).matches(origin) || code.isEmpty()) return
        pairing = origin to code
        val candidate = Api(origin)
        say(getString(R.string.wait))
        work.execute {
            val start = runCatching { candidate.get("/api/start") }
            runOnUiThread {
                start.onSuccess { s ->
                    t = s.optJSONObject("t") ?: JSONObject()
                    head.text = "CAPRI  ${s.optString("name")}"
                    say("${word("pairTitle", "Pair")}\n\n${Uri.parse(origin).host}", word("pairApp", "Pair")) { pair(candidate, code) }
                }.onFailure { say(word("offline", getString(R.string.offline))) }
            }
        }
    }

    private fun pair(candidate: Api, code: String) {
        say(getString(R.string.wait))
        work.execute {
            val made = runCatching {
                // the key made for this pairing (its code's SHA-256 in Google's attestation of it), and that attestation
                val typed = code.uppercase().replace(Regex("[^A-Z0-9]"), "")
                val key = JSONObject(Keys.make(MessageDigest.getInstance("SHA-256").digest(typed.toByteArray())) as Map<*, *>)
                val chain = JSONArray(Keys.attestation())
                candidate.post("/api/pair", JSONObject().put("code", typed).put("key", key).put("client", "app").put("attestation", chain)).getString("challenge")
            }
            runOnUiThread {
                made.onSuccess { challenge ->
                    pairing = null
                    api = candidate
                    prefs.edit().putString("origin", candidate.origin).apply()
                    hello(challenge)
                }.onFailure { e ->
                    pairing = null
                    val why = (e as? Api.Failed)?.message
                    say(if (why == "badCode") word("pairWrong", "Wrong code") else if (why == "noPairing") word("pairClosed", "No pairing") else "${word("failed", "")} ${e.message}")
                }
            }
        }
    }

    // --- unlocking: your fingerprint, her key signs a fresh challenge, a session ---------------------------

    private fun unlock() {
        val api = api
        if (api == null || !Keys.has()) return say(getString(R.string.not_paired))
        say(getString(R.string.wait))
        work.execute {
            val start = runCatching { api.get("/api/start") }
            runOnUiThread {
                start.onSuccess { s ->
                    t = s.optJSONObject("t") ?: JSONObject()
                    remember(api.origin, s)
                    // this PC doesn't know her app's key (yet): said so, and the others to go to
                    if (!s.optBoolean("paired")) return@runOnUiThread say(getString(R.string.unknown_here, s.optString("name")), getString(R.string.other_pc)) { elsewhere(api.origin) }
                    say(word("unlockSub", ""), word("unlock", "Unlock")) { unlock() }
                    hello(s.getString("challenge"))
                }.onFailure {
                    // this PC doesn't answer: another of your swarm that does, by itself if there's only one
                    elsewhere(api.origin) { say(word("offline", getString(R.string.offline)), word("unlock", "Unlock")) { unlock() } }
                }
            }
        }
    }

    // --- your PCs: the one she answers on, and the others of her swarm with her page on -----------------

    private class Pc(val name: String, val url: String, val here: Boolean)

    private val tsNet = Regex("^https://[a-z0-9-]+(\\.[a-z0-9-]+)*\\.ts\\.net:\\d{2,5}$", RegexOption.IGNORE_CASE)

    // what this PC said of itself and of the others answering now, kept for when it's the one that's away;
    // the name on top, with ▾ when there's another to go to
    private fun remember(origin: String, s: JSONObject) {
        val all = JSONArray().put(JSONObject().put("name", s.optString("name")).put("url", origin))
        val pcs = s.optJSONArray("pcs") ?: JSONArray()
        var others = 0
        for (i in 0 until pcs.length()) {
            val p = pcs.getJSONObject(i)
            val url = p.optString("url").trimEnd('/')
            if (!tsNet.matches(url) || url == origin) continue
            all.put(JSONObject().put("name", p.optString("name")).put("url", url))
            others++
        }
        prefs.edit().putString("pcs", all.toString()).apply()
        head.text = "CAPRI  ${s.optString("name")}${if (s.optBoolean("here")) " ★" else ""}${if (others > 0) "  ▾" else ""}"
        head.setOnClickListener(if (others > 0) View.OnClickListener { elsewhere(origin) } else null)
    }

    // another of your PCs that answers: by itself if there's only one, your pick if there are more, else
    // `none` (or a word that none answers)
    private fun elsewhere(from: String, none: (() -> Unit)? = null) {
        alive { found ->
            val others = found.filter { it.url != from }
            when {
                others.size == 1 -> switchTo(others[0].url)
                others.size > 1 -> pick(found)
                none != null -> none()
                else -> Toast.makeText(this, getString(R.string.others_silent), Toast.LENGTH_SHORT).show()
            }
        }
    }

    // your PCs that answer now (her page on them), asked all at once
    private fun alive(then: (List<Pc>) -> Unit) {
        val known = runCatching { JSONArray(prefs.getString("pcs", "[]")) }.getOrDefault(JSONArray())
        val urls = (0 until known.length()).map { known.getJSONObject(it).optString("url") }.filter { tsNet.matches(it) }.distinct()
        if (urls.isEmpty()) return then(emptyList())
        val found = java.util.Collections.synchronizedList(mutableListOf<Pc>())
        val left = java.util.concurrent.atomic.AtomicInteger(urls.size)
        for (url in urls) {
            Thread {
                runCatching { Api(url, 3000).get("/api/start") }.getOrNull()?.let { found.add(Pc(it.optString("name"), url, it.optBoolean("here"))) }
                if (left.decrementAndGet() == 0) runOnUiThread { then(found.sortedBy { it.name }) }
            }.start()
        }
    }

    private fun pick(pcs: List<Pc>) {
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.pick_pc))
            .setItems(pcs.map { if (it.here) "${it.name}  ★ ${getString(R.string.she_is_here)}" else it.name }.toTypedArray()) { _, i -> switchTo(pcs[i].url) }
            .show()
    }

    // her chat on another PC: a session there, your fingerprint again
    private fun switchTo(url: String) {
        if (url == api?.origin && unlocked) return
        lock()
        log.removeAllViews()
        api = Api(url)
        prefs.edit().putString("origin", url).apply()
        unlock()
    }

    private fun hello(challenge: String) {
        val api = api ?: return
        fingerprint(word("unlockTitle", "Capri"), word("unlockSub", "")) { signer ->
            work.execute {
                val ok = runCatching { api.post("/api/hello", JSONObject().put("challenge", challenge).put("sig", Keys.sign(signer, Keys.hello(challenge)))) }
                runOnUiThread {
                    if (ok.isSuccess) open() else say(word("lost", getString(R.string.not_paired)))
                }
            }
        }
    }

    // your fingerprint, then `then` with her key ready to sign once
    private fun fingerprint(title: String, subtitle: String, then: (Signature) -> Unit) {
        val signer = try {
            Keys.signer()
        } catch (e: KeyPermanentlyInvalidatedException) {
            Keys.forget() // a fingerprint added since: her key is gone, pair again
            return say(word("lost", getString(R.string.not_paired)))
        }
        val prompt = BiometricPrompt.Builder(this)
            .setTitle(title)
            .apply { if (subtitle.isNotEmpty()) setSubtitle(subtitle) }
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .setNegativeButton(getString(android.R.string.cancel), mainExecutor) { _, _ -> }
            .build()
        prompt.authenticate(BiometricPrompt.CryptoObject(signer), CancellationSignal(), mainExecutor, object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                result.cryptoObject?.signature?.let(then)
            }
        })
    }

    private fun lock() {
        if (!unlocked) return
        unlocked = false
        listening++
        pending = null
        val api = api ?: return
        work.execute {
            api.hangUp() // (closing it is network work: not on the screen's thread)
            runCatching { api.post("/api/bye", JSONObject()) }
            api.cookie = null
        }
    }

    // --- her chat --------------------------------------------------------------------------------------

    private fun open() {
        unlocked = true
        order.text = word("order", "Order")
        input.hint = word("placeholder", "")
        send.text = word("send", "Send")
        message.visibility = View.GONE
        action.visibility = View.GONE
        chat.visibility = View.VISIBLE
        history()
        listen()
        background()
    }

    // Her listening key, given to her PC now that your fingerprint opened her app (her swarm carries it to
    // the others), then her service in the background; and, once, what Android asks for it to work: showing
    // notifications, and not being put to sleep with the phone (else her notes come minutes late)
    private fun background() {
        val api = api ?: return
        work.execute {
            val key = prefs.getString("listenKey", null)?.takeIf { Keys.hasListen() }
                ?: JSONObject(Keys.makeListen() as Map<*, *>).toString().also { prefs.edit().putString("listenKey", it).apply() }
            val given = runCatching { api.post("/api/listen-key", JSONObject().put("key", JSONObject(key))) }.isSuccess
            runOnUiThread {
                if (!given) return@runOnUiThread
                Listener.start(this)
                val mayNotify = Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
                if (!mayNotify && !prefs.getBoolean("askedNotify", false)) {
                    prefs.edit().putBoolean("askedNotify", true).apply()
                    requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
                } else if (!getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName) && !prefs.getBoolean("askedBattery", false)) {
                    prefs.edit().putBoolean("askedBattery", true).apply()
                    runCatching { startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))) }
                }
            }
        }
    }

    private fun history() {
        val api = api ?: return
        work.execute {
            val got = runCatching { api.get("/api/history").getJSONArray("history") }
            runOnUiThread {
                val list = got.getOrNull() ?: return@runOnUiThread
                log.removeAllViews()
                val all = (0 until list.length()).map { list.getJSONObject(it) } + notes
                for (m in all.sortedBy { it.optLong("at") }) {
                    if (m.has("line")) note(m, false) else bubble(m.optString("role") == "user", m.optString("content"))
                }
                pending?.let { log.addView(it.second) }
                // her widget: your last words with her, from her chat as it is now (said elsewhere too)
                Widget.set(this, all.sortedBy { it.optLong("at") }.map { m ->
                    if (m.has("line")) false to listOf(m.optString("project"), m.optString("line")).filter { it.isNotEmpty() }.joinToString(" · ")
                    else (m.optString("role") == "user") to (if (m.optString("role") == "user") m.optString("content") else clean(m.optString("content")))
                }.filter { it.second.isNotBlank() }, word("you", ""))
                down()
            }
        }
    }

    // her answers and notes, as long as she's unlocked; the session gone (her PC restarted): unlocked again
    // Only the newest listener hears her: one from before the app was put away and opened again stops at
    // once (else both would put each piece of her answer in, and her words would come out twice, mixed).
    @Volatile private var listening = 0

    private fun listen() {
        val api = api ?: return
        val mine = ++listening
        val live = { unlocked && listening == mine }
        Thread {
            while (live()) {
                val since = prefs.getLong("since", System.currentTimeMillis().also { prefs.edit().putLong("since", it).apply() })
                val status = runCatching { api.listen(since, live) { event, data -> runOnUiThread { if (live()) heard(event, data) } } }.getOrDefault(0)
                if (status == 401 && live()) {
                    runOnUiThread { unlocked = false; unlock() }
                    return@Thread
                }
                if (live()) Thread.sleep(3000)
            }
        }.start()
    }

    private fun heard(event: String, data: JSONObject) {
        val id = data.optString("id")
        when (event) {
            "delta" -> pending?.takeIf { it.first == id }?.second?.let { it.text = "${if (it.tag == "wait") "" else it.text}${data.optString("text")}"; it.tag = null }
            "answer" -> pending?.takeIf { it.first == id }?.let { (_, view) ->
                pending = null
                send.isEnabled = true
                view.text = if (data.optBoolean("ok")) clean(data.optString("text")) else "${word("failed", "")} ${data.optString("error")}"
                if (data.optBoolean("ok")) Widget.add(this, false, clean(data.optString("text")))
            }
            "note" -> if (notes.none { it.optString("id") == id }) {
                notes.add(data)
                prefs.edit().putLong("since", data.optLong("at")).apply()
                note(data, true)
                Widget.add(this, false, listOf(data.optString("project"), data.optString("line")).filter { it.isNotEmpty() }.joinToString(" · "))
            }
        }
        down()
    }

    private fun sendText(text: String) {
        val words = text.trim()
        if (words.isEmpty()) return
        input.setText("")
        val isOrder = order.isChecked
        order.isChecked = false
        val api = api ?: return
        send.isEnabled = false
        if (!isOrder) {
            work.execute { posted(runCatching { api.post("/api/send", JSONObject().put("text", words)).getString("id") }, words, false) }
            return
        }
        // an order: which PC it's for first ("Chrome on Legion": straight to Legion, no PC to pick here)
        work.execute {
            val route = runCatching { api.post("/api/route", JSONObject().put("text", words)) }.getOrNull()
            val url = route?.optString("url").orEmpty().trimEnd('/')
            if (route != null && !route.optBoolean("here") && tsNet.matches(url) && url != api.origin) {
                return@execute runOnUiThread { orderThere(Api(url, read = 360_000), route.optString("name"), words) }
            }
            if (route != null && !route.optBoolean("here")) { // named a PC that doesn't answer now
                return@execute runOnUiThread {
                    send.isEnabled = true
                    bubble(false, "${route.optString("name")}: ${getString(R.string.others_silent)}")
                    down()
                }
            }
            // here: a challenge of its own, your fingerprint, her key signs this order and only this one
            val challenge = runCatching { api.get("/api/challenge").getString("challenge") }
            runOnUiThread {
                challenge.onFailure { posted(Result.failure(it), words, true) }.onSuccess { c ->
                    send.isEnabled = true
                    fingerprint(word("confirmTitle", "Order"), words.take(120)) { signer ->
                        send.isEnabled = false
                        work.execute {
                            posted(runCatching {
                                api.post("/api/order", JSONObject().put("text", words).put("challenge", c).put("sig", Keys.sign(signer, Keys.order(c, words)))).getString("id")
                            }, words, true)
                        }
                    }
                }
            }
        }
    }

    // An order for another PC of your swarm, sent there straight from here (the swarm never carries one): its
    // own challenge from that PC, your fingerprint, her key signs it; that PC knows her app's key through her
    // swarm, needs no session for a signed order, and answers with what she did.
    private fun orderThere(there: Api, name: String, words: String) {
        work.execute {
            val challenge = runCatching { there.get("/api/challenge").getString("challenge") }
            runOnUiThread {
                challenge.onFailure { e ->
                    send.isEnabled = true
                    bubble(false, "$name: ${if ((e as? Api.Failed)?.status == 401) getString(R.string.unknown_here, name) else getString(R.string.others_silent)}")
                    down()
                }.onSuccess { c ->
                    send.isEnabled = true
                    fingerprint(word("confirmTitle", "Order"), "→ $name: ${words.take(110)}") { signer ->
                        send.isEnabled = false
                        bubble(true, "${word("order", "Order")} → $name: $words")
                        Widget.add(this, true, "→ $name: $words")
                        val view = bubble(false, word("thinking", "…"))
                        down()
                        work.execute {
                            val done = runCatching {
                                there.post("/api/order", JSONObject().put("text", words).put("challenge", c).put("sig", Keys.sign(signer, Keys.order(c, words))))
                            }
                            runOnUiThread {
                                send.isEnabled = true
                                val a = done.getOrNull()
                                view.text = when {
                                    a == null -> "$name: ${word("offline", getString(R.string.offline))}"
                                    a.optBoolean("ok") -> "$name: ${clean(a.optString("text"))}".also { Widget.add(this, false, it) }
                                    else -> "$name: ${word("failed", "")} ${a.optString("error")}"
                                }
                                down()
                            }
                        }
                    }
                }
            }
        }
    }

    private fun posted(id: Result<String>, words: String, isOrder: Boolean) = runOnUiThread {
        id.onSuccess {
            bubble(true, if (isOrder) "${word("order", "Order")}: $words" else words)
            Widget.add(this, true, words)
            val view = bubble(false, word("thinking", "…"))
            view.tag = "wait"
            pending = it to view
        }.onFailure { e ->
            send.isEnabled = true
            input.setText(words)
            val why = (e as? Api.Failed)?.message
            // (her app's key paired before her PCs checked Google's attestation of it: pair her app again)
            bubble(false, when {
                why == "tooMany" -> word("tooMany", "")
                why == "notApp" -> word("notApp", "")
                why == "notAttested" -> word("lost", getString(R.string.not_paired))
                else -> word("offline", getString(R.string.offline))
            })
        }
        down()
    }

    // --- what's on screen ------------------------------------------------------------------------------

    private fun build() {
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(bg); fitsSystemWindows = true }
        head = TextView(this).apply {
            text = "CAPRI"
            setTextColor(red)
            textSize = 18f
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = 0.15f
            setPadding(dp(16), dp(12), dp(16), dp(10))
        }
        message = TextView(this).apply { setTextColor(dim); textSize = 15f; setPadding(dp(16), dp(24), dp(16), dp(12)) }
        action = Button(this).apply { visibility = View.GONE; setTextColor(red); setBackgroundColor(Color.rgb(40, 18, 20)) }
        log = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(8), dp(12), dp(8)) }
        scroll = ScrollView(this).apply { addView(log); isFillViewport = true }
        input = EditText(this).apply {
            setTextColor(Color.WHITE)
            setHintTextColor(dim)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            maxLines = 5
            imeOptions = EditorInfo.IME_ACTION_SEND
        }
        order = CheckBox(this).apply { setTextColor(yellow); buttonTintList = android.content.res.ColorStateList.valueOf(yellow) }
        send = Button(this).apply { setTextColor(red); setBackgroundColor(Color.rgb(40, 18, 20)); setOnClickListener { sendText(input.text.toString()) } }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(4), dp(12), dp(8))
            addView(input, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
            addView(send, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT))
        }
        chat = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
            addView(scroll, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
            addView(order, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { marginStart = dp(12) })
            addView(bar)
        }
        // her name and the PC on the left, her app's version on the right
        val version = TextView(this).apply {
            text = "v" + runCatching { packageManager.getPackageInfo(packageName, 0).versionName }.getOrNull().orEmpty()
            setTextColor(dim)
            textSize = 12f
            setPadding(dp(8), dp(12), dp(16), dp(10))
        }
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(head, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
            addView(version, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT))
        }
        root.addView(top)
        root.addView(message)
        root.addView(action, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { setMargins(dp(16), 0, dp(16), 0) })
        root.addView(chat, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
        setContentView(root)
    }

    // a message on screen instead of her chat, and a button under it if there's something to do
    private fun say(text: String, button: String? = null, onClick: (() -> Unit)? = null) {
        chat.visibility = View.GONE
        message.visibility = View.VISIBLE
        message.text = text
        action.visibility = if (button != null) View.VISIBLE else View.GONE
        action.text = button.orEmpty()
        action.setOnClickListener { onClick?.invoke() }
    }

    private fun box(color: Int, fill: Int) = GradientDrawable().apply { setStroke(dp(1), color); setColor(fill) }

    // one message: hers in yellow on the left, yours in cyan on the right, as in Mainframe's HOLO
    private fun bubble(you: Boolean, text: String): TextView {
        val view = TextView(this).apply {
            this.text = if (you) text else clean(text)
            textSize = 15f
            setTextColor(if (you) cyan else yellow)
            background = box(if (you) cyan else yellow, if (you) Color.argb(18, 94, 246, 255) else Color.argb(13, 242, 231, 80))
            setPadding(dp(12), dp(8), dp(12), dp(8))
            setTextIsSelectable(true)
        }
        log.addView(view, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply {
            gravity = if (you) Gravity.END else Gravity.START
            setMargins(if (you) dp(48) else 0, dp(5), if (you) 0 else dp(48), dp(5))
        })
        return view
    }

    // one of her notes while you were away: dimmer, its project on top
    private fun note(n: JSONObject, fresh: Boolean) {
        val text = listOf(n.optString("project"), n.optString("line"), n.optString("quote")).filter { it.isNotEmpty() }.joinToString("\n")
        val view = bubble(false, text)
        view.background = box(Color.argb(115, 242, 231, 80), Color.TRANSPARENT)
        if (fresh) down()
    }

    private fun clean(text: String) = text.replace(Regex("\\[\\[[^\\]]*]]"), "").trim() // [[open: …]], as her chat hides them

    private fun down() = scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }

    private fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()
}
