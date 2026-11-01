package io.github.nfgh057.capri

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec

// Her app's key: made in Android Keystore (in the phone's secure hardware, StrongBox if it has one), never
// read out of it, and usable only right after your fingerprint, once per use: unlocking her app signs one
// challenge, each order signs one more. A new fingerprint added on the phone ends it (pair again).
object Keys {
    private const val ALIAS = "capri-app"
    private const val STORE = "AndroidKeyStore"

    private fun store(): KeyStore = KeyStore.getInstance(STORE).apply { load(null) }

    fun has(): Boolean = store().containsAlias(ALIAS)

    fun forget() {
        store().deleteEntry(ALIAS)
    }

    // a new key (the old one gone): its public half, as her page's browser sends one (JWK, P-256)
    fun make(): Map<String, String> {
        forget()
        fun spec(strongBox: Boolean) = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(true)
            .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG) // 0: every use, not "for a while"
            .setInvalidatedByBiometricEnrollment(true)
            .setIsStrongBoxBacked(strongBox)
            .build()
        val gen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, STORE)
        val pair = try {
            gen.initialize(spec(true))
            gen.generateKeyPair()
        } catch (e: StrongBoxUnavailableException) {
            gen.initialize(spec(false))
            gen.generateKeyPair()
        }
        val point = (pair.public as ECPublicKey).w
        return mapOf("kty" to "EC", "crv" to "P-256", "x" to b64(fixed(point.affineX)), "y" to b64(fixed(point.affineY)))
    }

    // ready to sign, once your fingerprint lets it (BiometricPrompt's CryptoObject)
    fun signer(): Signature = Signature.getInstance("SHA256withECDSA").apply {
        initSign(store().getKey(ALIAS, null) as PrivateKey)
    }

    // what her PC checks, signed: r and s side by side (as WebCrypto signs), base64url
    fun sign(signature: Signature, data: String): String = b64(p1363(signature.run { update(data.toByteArray()); sign() }))

    // what a session's challenge and an order are signed as (src/main/pocket.js signed, orderSigned)
    fun hello(challenge: String) = "capri-pocket|$challenge"
    fun order(challenge: String, text: String): String {
        val hash = MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
        return "capri-pocket-order|$challenge|$hash"
    }

    private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

    // a coordinate as exactly 32 bytes
    private fun fixed(n: BigInteger): ByteArray {
        val raw = n.toByteArray().dropWhile { it == 0.toByte() }.toByteArray()
        return ByteArray(32 - raw.size) + raw
    }

    // Keystore's signature (DER: SEQUENCE of two INTEGERs) as r and s, 32 bytes each
    private fun p1363(der: ByteArray): ByteArray {
        var i = 2
        if (der[1].toInt() and 0x80 != 0) i += der[1].toInt() and 0x7f // a long length (not for P-256, but still)
        fun int(): BigInteger {
            require(der[i] == 0x02.toByte())
            val len = der[i + 1].toInt()
            val value = BigInteger(1, der.copyOfRange(i + 2, i + 2 + len))
            i += 2 + len
            return value
        }
        val r = int()
        val s = int()
        return fixed(r) + fixed(s)
    }
}
