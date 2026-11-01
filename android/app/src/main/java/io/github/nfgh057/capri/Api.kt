package io.github.nfgh057.capri

import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import javax.net.ssl.HttpsURLConnection

// Her page on your PC (src/main/pocket.js), as her app talks to it: over HTTPS on your Tailscale network, as
// the page itself (its own address as Origin, JSON), with the session it got for this phone's key.
// (`wait`: how long to reach it; `read`: how long an answer may take, an order done elsewhere a while)
class Api(val origin: String, private val wait: Int = 10_000, private val read: Int = 30_000) {
    class Failed(val status: Int, message: String) : Exception(message)

    @Volatile var cookie: String? = null
    @Volatile private var stream: HttpURLConnection? = null // her answers' stream, while one is open

    // the stream closed now (her app locked), not when it next hears something
    fun hangUp() {
        stream?.disconnect()
        stream = null
    }

    private fun open(path: String): HttpURLConnection {
        val conn = URL(origin + path).openConnection() as HttpURLConnection
        require(conn is HttpsURLConnection || origin.startsWith("http://127.0.0.1")) // her page is HTTPS, always
        conn.connectTimeout = wait
        conn.readTimeout = maxOf(wait, read)
        conn.setRequestProperty("Origin", origin)
        cookie?.let { conn.setRequestProperty("Cookie", it) }
        return conn
    }

    private fun answer(conn: HttpURLConnection): JSONObject {
        val status = conn.responseCode
        conn.getHeaderField("Set-Cookie")?.let { set ->
            val token = set.substringBefore(';')
            cookie = if (token.endsWith("=")) null else token
        }
        val stream = if (status in 200..299) conn.inputStream else conn.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        val json = runCatching { JSONObject(text) }.getOrDefault(JSONObject())
        if (status !in 200..299) throw Failed(status, json.optString("error", status.toString()))
        return json
    }

    fun get(path: String): JSONObject = open(path).let { conn -> try { answer(conn) } finally { conn.disconnect() } }

    fun post(path: String, body: JSONObject): JSONObject = open(path).let { conn ->
        try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            answer(conn)
        } finally {
            conn.disconnect()
        }
    }

    // Her answers and notes as they come (`/api/events`), each to `on(event, data)`, until `running()` says
    // stop or the stream ends; then the status it ended with (401: the session is gone).
    fun listen(since: Long, running: () -> Boolean, on: (String, JSONObject) -> Unit): Int {
        val conn = open("/api/events?since=$since")
        conn.readTimeout = 60_000 // she says something every 20 s
        stream = conn
        try {
            if (conn.responseCode != 200) return conn.responseCode
            BufferedReader(InputStreamReader(conn.inputStream)).use { reader ->
                var event = "message"
                val data = StringBuilder()
                while (running()) {
                    val line = reader.readLine() ?: break
                    when {
                        line.isEmpty() -> {
                            if (data.isNotEmpty()) runCatching { on(event, JSONObject(data.toString())) }
                            event = "message"
                            data.setLength(0)
                        }
                        line.startsWith("event:") -> event = line.removePrefix("event:").trim()
                        line.startsWith("data:") -> data.append(line.removePrefix("data:").trim())
                    }
                }
            }
            return 200
        } finally {
            if (stream === conn) stream = null
            conn.disconnect()
        }
    }
}
