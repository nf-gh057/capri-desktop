package io.github.nfgh057.capri

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color

// Her style on your phone, her app and her widget alike, picked in her app (the swatch on its top bar): Night City
// (the original project's, her in yellow, you in cyan, on ink), Original (this fork's, her in red, you in green)
// or Custom (two colours you pick, hers and yours). Everything else is made from her colour and yours, as on her
// PC (src/pocket/look.js): her pictures are white masks her app tints with them (res/values/colors.xml has Night
// City's, for until it does).
class Look(val style: String, val her: Int, val you: Int, val on: Int, val bg: Int) {
    val herDeep = mix(her, Color.BLACK, 0.88f)  // her frames
    val herText = mix(her, Color.WHITE, 0.35f)  // her words in her bubbles
    val youText = mix(you, Color.WHITE, 0.35f)
    val dim = mix(her, Color.rgb(160, 160, 156), 0.15f) // what's said around her chat
    val wash = mix(her, bg, 0.12f)                     // a button's ground

    companion object {
        const val NIGHT_CITY = "nightcity"
        const val ORIGINAL = "original"
        const val CUSTOM = "custom"
        val STYLES = listOf(NIGHT_CITY, ORIGINAL, CUSTOM)
        // the colours Custom starts with, as on her PC (main/config.js customHer, customYou)
        val CUSTOM_HER = Color.rgb(0xff, 0x5f, 0xd2)
        val CUSTOM_YOU = Color.rgb(0x7c, 0x9c, 0xff)
        // what Custom's two colours are picked from, or a hex code
        val SWATCHES = listOf(
            "#ff5f56", "#ff1f4b", "#ff7a1a", "#ffb000", "#f2e750", "#b6ff3c",
            "#57e389", "#3cffa0", "#5ef6ff", "#7c9cff", "#c77dff", "#ff5fd2",
        ).map(Color::parseColor)

        private fun prefs(context: Context) = context.getSharedPreferences("capri", Context.MODE_PRIVATE)

        fun of(context: Context): Look {
            val p = prefs(context)
            return when (p.getString("style", NIGHT_CITY)) {
                ORIGINAL -> Look(ORIGINAL, Color.rgb(255, 95, 86), Color.rgb(87, 227, 137), Color.rgb(242, 231, 80), Color.rgb(11, 10, 15))
                CUSTOM -> {
                    val her = p.getInt("customHer", CUSTOM_HER)
                    val you = p.getInt("customYou", CUSTOM_YOU)
                    Look(CUSTOM, her, you, you, mix(her, Color.rgb(11, 11, 13), 0.05f))
                }
                else -> Look(NIGHT_CITY, Color.rgb(242, 231, 80), Color.rgb(94, 246, 255), Color.rgb(94, 246, 255), Color.rgb(17, 18, 16))
            }
        }

        // her style picked (and Custom's colours, when given): her widget drawn again in it
        fun pick(context: Context, style: String, her: Int? = null, you: Int? = null) {
            prefs(context).edit().putString("style", style).apply {
                her?.let { putInt("customHer", it or 0xff000000.toInt()) }
                you?.let { putInt("customYou", it or 0xff000000.toInt()) }
            }.apply()
            Widget.redraw(context)
        }

        fun tint(color: Int): ColorStateList = ColorStateList.valueOf(color)

        // k of the first colour, the rest the second's
        fun mix(a: Int, b: Int, k: Float): Int = Color.rgb(
            (Color.red(a) * k + Color.red(b) * (1 - k)).toInt(),
            (Color.green(a) * k + Color.green(b) * (1 - k)).toInt(),
            (Color.blue(a) * k + Color.blue(b) * (1 - k)).toInt(),
        )

        fun hex(color: Int) = "#%06x".format(color and 0xffffff)
    }
}
