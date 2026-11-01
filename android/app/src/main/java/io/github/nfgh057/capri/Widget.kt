package io.github.nfgh057.capri

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject

// Her widget on your home screen, as calls in her game: your last words with her (hers red on the left, yours
// green on the right, each under its name, in a neon bubble), and along its bottom edge her HUD bar with the call
// and message buttons, which open her app (your fingerprint, then her chat). Nothing on it can do anything on
// your PCs.
class Widget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        draw(context, manager, ids)
    }

    companion object {
        private const val KEEP = 20 // the last words kept: two in view, the others above them

        private fun prefs(context: Context) = context.getSharedPreferences("capri", Context.MODE_PRIVATE)

        // what was said, newest last: [{ you, text }] (`you`: yours, else hers), and your name as she calls you
        fun set(context: Context, said: List<Pair<Boolean, String>>, you: String? = null) {
            val list = JSONArray()
            for ((mine, text) in said.takeLast(KEEP)) list.put(JSONObject().put("you", mine).put("text", text.take(300)))
            prefs(context).edit().putString("widgetLog", list.toString()).apply { if (!you.isNullOrBlank()) putString("you", you) }.apply()
            redraw(context)
        }

        // one more: hers (a note, an answer) or yours
        fun add(context: Context, you: Boolean, text: String) {
            if (text.isBlank()) return
            set(context, said(context) + (you to text))
        }

        // how many PCs of your swarm answer now (her PC says, when her app or her service asks), for LNK//02
        fun online(context: Context, count: Int) {
            if (count <= 0 || prefs(context).getInt("online", -1) == count) return
            prefs(context).edit().putInt("online", count).apply()
            redraw(context)
        }

        private fun said(context: Context): List<Pair<Boolean, String>> {
            val list = runCatching { JSONArray(prefs(context).getString("widgetLog", "[]")) }.getOrDefault(JSONArray())
            return (0 until list.length()).map { list.getJSONObject(it) }.map { it.optBoolean("you") to it.optString("text") }
        }

        private fun redraw(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            draw(context, manager, manager.getAppWidgetIds(ComponentName(context, Widget::class.java)))
        }

        private fun draw(context: Context, manager: AppWidgetManager, ids: IntArray) {
            val said = said(context).ifEmpty { listOf(false to context.getString(R.string.widget_empty)) }
            val you = prefs(context).getString("you", null)?.takeIf { it.isNotBlank() } ?: context.getString(R.string.widget_you)
            val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
            fun row(mine: Boolean, text: String) = RemoteViews(context.packageName, if (mine) R.layout.widget_row_you else R.layout.widget_row_capri).apply {
                setTextViewText(R.id.row_name, if (mine) you else "Capri")
                setTextViewText(R.id.row_text, text)
            }
            for (id in ids) {
                val views = RemoteViews(context.packageName, R.layout.widget)
                if (Build.VERSION.SDK_INT >= 31) {
                    // a list that scrolls: the newest at the bottom, older ones above with a finger; a tap opens her app
                    val items = RemoteViews.RemoteCollectionItems.Builder().setViewTypeCount(2)
                    said.forEachIndexed { i, (mine, text) -> items.addItem(i.toLong(), row(mine, text).apply { setOnClickFillInIntent(R.id.row, Intent()) }) }
                    views.setRemoteAdapter(R.id.widget_list, items.build())
                    val tap = PendingIntent.getActivity(context, 1, Intent(context, MainActivity::class.java), PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
                    views.setPendingIntentTemplate(R.id.widget_list, tap)
                } else {
                    // (Android 11: the last few, as they are, from the bottom; what doesn't fit is cut at the top)
                    views.setViewVisibility(R.id.widget_list, View.GONE)
                    views.setViewVisibility(R.id.widget_log, View.VISIBLE)
                    views.removeAllViews(R.id.widget_log)
                    for ((mine, text) in said.takeLast(6)) views.addView(R.id.widget_log, row(mine, text))
                    views.setOnClickPendingIntent(R.id.widget_log, open)
                }
                val online = prefs(context).getInt("online", -1)
                views.setTextViewText(R.id.widget_lnk, if (online > 0) "LNK//%02d".format(online) else "LNK//--")
                views.setOnClickPendingIntent(R.id.widget_write, open)
                // talking to her: her app for now; her voice, with the microphone, is to come (TODO.md)
                val talk = Intent(context, MainActivity::class.java).putExtra("talk", true)
                views.setOnClickPendingIntent(R.id.widget_call, PendingIntent.getActivity(context, 2, talk, PendingIntent.FLAG_IMMUTABLE))
                manager.updateAppWidget(id, views)
            }
        }
    }
}
