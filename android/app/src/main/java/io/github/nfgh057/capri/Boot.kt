package io.github.nfgh057.capri

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// The phone started (or her app was updated): she listens for her notes again, if she's paired
class Boot : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) Listener.start(context)
    }
}
