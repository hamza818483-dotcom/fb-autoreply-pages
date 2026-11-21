package com.hamza818483.fbautoreply

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * JS bridge exposed ONLY to the app's own dashboard origin (see
 * MainActivity's shouldOverrideUrlLoading host allowlist — this WebView
 * never navigates to untrusted third-party pages, so this bridge is not
 * reachable from arbitrary web content).
 *
 * Saves a finished video as a real .mp4 file into the device's
 * Movies/FBAutoReply gallery folder via MediaStore (no raw file path
 * permissions needed, works on scoped storage / Android 10+).
 *
 * The web page can call either:
 *   AndroidVideoSaver.saveFromUrl(url, fileName)       — downloads the URL itself
 *   AndroidVideoSaver.saveFromBase64(base64, fileName) — e.g. Clip Maker's in-browser output
 */
class VideoSaverBridge(private val activity: ComponentActivity) {

    private val appContext: Context get() = activity.applicationContext
    private val folderName = "FBAutoReply"

    @JavascriptInterface
    fun saveFromBase64(base64Data: String, fileName: String) {
        Thread {
            try {
                val clean = base64Data.substringAfter(",", base64Data) // strip data: URL prefix if present
                val bytes = Base64.decode(clean, Base64.DEFAULT)
                writeMp4(bytes.inputStream(), safeName(fileName))
            } catch (e: Exception) {
                Log.e("VideoSaverBridge", "saveFromBase64 failed", e)
                notifyFailure()
            }
        }.start()
    }

    @JavascriptInterface
    fun saveFromUrl(url: String, fileName: String) {
        Thread {
            try {
                val connection = URL(url).openConnection() as HttpURLConnection
                connection.connectTimeout = 15000
                connection.readTimeout = 60000
                connection.instanceFollowRedirects = true
                connection.connect()

                if (connection.responseCode !in 200..299) {
                    throw IllegalStateException("HTTP ${connection.responseCode}")
                }

                connection.inputStream.use { input ->
                    writeMp4(input, safeName(fileName))
                }
            } catch (e: Exception) {
                Log.e("VideoSaverBridge", "saveFromUrl failed", e)
                notifyFailure()
            }
        }.start()
    }

    private fun safeName(name: String): String {
        val base = name.ifBlank { "video_${System.currentTimeMillis()}" }
            .replace(Regex("[^A-Za-z0-9._-]"), "_")
        return if (base.endsWith(".mp4", ignoreCase = true)) base else "$base.mp4"
    }

    private fun writeMp4(input: java.io.InputStream, displayName: String) {
        val resolver = appContext.contentResolver

        val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Video.Media.DISPLAY_NAME, displayName)
                put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                put(MediaStore.Video.Media.RELATIVE_PATH, "${Environment.DIRECTORY_MOVIES}/$folderName")
                put(MediaStore.Video.Media.IS_PENDING, 1)
            }
            resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)
        } else {
            @Suppress("DEPRECATION")
            val moviesDir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), folderName)
            if (!moviesDir.exists()) moviesDir.mkdirs()
            val file = File(moviesDir, displayName)
            val values = ContentValues().apply {
                put(MediaStore.Video.Media.DISPLAY_NAME, displayName)
                put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                put(MediaStore.Video.Media.DATA, file.absolutePath)
            }
            resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)
        } ?: throw IllegalStateException("MediaStore insert failed")

        val out: OutputStream = resolver.openOutputStream(uri)
            ?: throw IllegalStateException("Cannot open output stream")

        out.use { output ->
            input.use { it.copyTo(output) }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Video.Media.IS_PENDING, 0)
            }
            resolver.update(uri, values, null, null)
        }

        notifySuccess(displayName)
    }

    private fun notifySuccess(displayName: String) {
        activity.runOnUiThread {
            Toast.makeText(
                appContext,
                "$displayName গ্যালারিতে সেভ হয়েছে",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    private fun notifyFailure() {
        activity.runOnUiThread {
            Toast.makeText(
                appContext,
                "ভিডিও সেভ করা যায়নি, আবার চেষ্টা করুন",
                Toast.LENGTH_LONG
            ).show()
        }
    }
}
