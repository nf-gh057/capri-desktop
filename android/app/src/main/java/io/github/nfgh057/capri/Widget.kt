package io.github.nfgh057.capri

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

// Her widget on your home screen: the last thing she said (an answer, or a note while you were away), and
// "Write" to open her app (your fingerprint, then her chat). Nothing on it can do anything on your PCs.
class Widget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        draw(context, manager, ids)
    }

    companion object {
        // her latest words, kept and put on every widget of hers
        fun show(context: Context, text: String) {
            context.getSharedPreferences("capri", Context.MODE_PRIVATE).edit().putString("widget", text.take(400)).apply()
            val manager = AppWidgetManager.getInstance(context)
            draw(context, manager, manager.getAppWidgetIds(ComponentName(context, Widget::class.java)))
        }

        private fun draw(context: Context, manager: AppWidgetManager, ids: IntArray) {
            val text = context.getSharedPreferences("capri", Context.MODE_PRIVATE).getString("widget", null)
                ?: context.getString(R.string.widget_empty)
            val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
            for (id in ids) {
                val views = RemoteViews(context.packageName, R.layout.widget).apply {
                    setTextViewText(R.id.widget_text, text)
                    setTextViewText(R.id.widget_write, context.getString(R.string.widget_write))
                    setOnClickPendingIntent(R.id.widget_write, open)
                    setOnClickPendingIntent(R.id.widget_text, open)
                }
                manager.updateAppWidget(id, views)
            }
        }
    }
}
