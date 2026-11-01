package io.github.nfgh057.capri

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject

// Her widget on your home screen, as calls in her game: your last words with her (hers red on the left, yours
// green on the right, each under its name), and MSG with her name in a call box, which opens her app (your
// fingerprint, then her chat). Nothing on it can do anything on your PCs.
class Widget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        draw(context, manager, ids)
    }

    companion object {
        private const val KEEP = 3 // the last words shown

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
            for (id in ids) {
                val views = RemoteViews(context.packageName, R.layout.widget)
                views.removeAllViews(R.id.widget_log)
                for ((mine, text) in said) {
                    val row = RemoteViews(context.packageName, if (mine) R.layout.widget_row_you else R.layout.widget_row_capri)
                    row.setTextViewText(R.id.row_name, if (mine) you else "Capri")
                    row.setTextViewText(R.id.row_text, text)
                    views.addView(R.id.widget_log, row)
                }
                views.setOnClickPendingIntent(R.id.widget_write, open)
                views.setOnClickPendingIntent(R.id.widget_log, open)
                manager.updateAppWidget(id, views)
            }
        }
    }
}
