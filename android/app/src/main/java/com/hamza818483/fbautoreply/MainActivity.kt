package com.hamza818483.fbautoreply

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.net.toUri
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.hamza818483.fbautoreply.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val dashboardUrl by lazy { getString(R.string.dashboard_url) }
    private val dashboardHost by lazy { dashboardUrl.toUri().host.orEmpty() }

    // Hosts that must open inside the app's own WebView rather than an
    // external browser — the dashboard domain itself and its API/auth
    // surfaces (Supabase auth redirects, Cloudflare worker endpoints).
    private val internalHostSuffixes = listOf(
        "pages.dev",
        "supabase.co",
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupWebView()
        setupSwipeRefresh()
        setupRetry()
        setupBackPress()

        if (savedInstanceState == null) {
            loadDashboard()
        } else {
            binding.webView.restoreState(savedInstanceState)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val webView = binding.webView
        val settings: WebSettings = webView.settings

        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.loadWithOverviewMode = true
        settings.useWideViewPort = true
        settings.setSupportZoom(false)
        settings.mediaPlaybackRequiresUserGesture = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW

        // Persistent login: cookies survive app restarts.
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(webView, true)

        // Bridge is scoped to this WebView, which (via shouldOverrideUrlLoading
        // below) only ever navigates to the dashboard's own origin / Supabase —
        // never to arbitrary third-party content.
        webView.addJavascriptInterface(VideoSaverBridge(this), "AndroidVideoSaver")

        webView.webViewClient = object : WebViewClient() {

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val uri = request.url
                val host = uri.host.orEmpty()

                val isInternal = host == dashboardHost ||
                    internalHostSuffixes.any { host.endsWith(it) }

                return if (isInternal) {
                    false // load inside this WebView
                } else {
                    openExternally(uri)
                    true
                }
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                showContent()
                binding.progressBar.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView, url: String?) {
                super.onPageFinished(view, url)
                binding.progressBar.visibility = View.GONE
                binding.swipeRefresh.isRefreshing = false
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                super.onReceivedError(view, request, error)
                if (request.isForMainFrame) {
                    binding.progressBar.visibility = View.GONE
                    binding.swipeRefresh.isRefreshing = false
                    showError(getString(R.string.error_load_failed))
                }
            }

            override fun onReceivedSslError(
                view: WebView,
                handler: SslErrorHandler,
                error: SslError
            ) {
                // Never proceed past certificate errors.
                handler.cancel()
                showError(getString(R.string.error_load_failed))
            }
        }
    }

    private fun openExternally(uri: Uri) {
        val customTabsIntent = CustomTabsIntent.Builder().build()
        runCatching {
            customTabsIntent.launchUrl(this, uri)
        }.onFailure {
            val fallback = Intent(Intent.ACTION_VIEW, uri)
            runCatching { startActivity(fallback) }
        }
    }

    private fun setupSwipeRefresh() {
        binding.swipeRefresh.setColorSchemeResources(R.color.brand_primary)
        binding.swipeRefresh.setOnRefreshListener { reload() }
    }

    private fun setupRetry() {
        binding.retryButton.setOnClickListener { reload() }
    }

    private fun setupBackPress() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (binding.webView.canGoBack()) {
                    binding.webView.goBack()
                } else {
                    confirmExit()
                }
            }
        })
    }

    private fun confirmExit() {
        AlertDialog.Builder(this)
            .setTitle(R.string.exit_title)
            .setMessage(R.string.exit_message)
            .setPositiveButton(R.string.yes) { _, _ -> finish() }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun loadDashboard() {
        if (!NetworkUtil.isOnline(this)) {
            showError(getString(R.string.error_no_internet))
            return
        }
        showContent()
        binding.webView.loadUrl(dashboardUrl)
    }

    private fun reload() {
        if (!NetworkUtil.isOnline(this)) {
            binding.swipeRefresh.isRefreshing = false
            showError(getString(R.string.error_no_internet))
            return
        }
        showContent()
        if (binding.webView.url == null) {
            binding.webView.loadUrl(dashboardUrl)
        } else {
            binding.webView.reload()
        }
    }

    private fun showError(message: String) {
        binding.errorText.text = message
        binding.errorView.visibility = View.VISIBLE
        binding.swipeRefresh.visibility = View.GONE
    }

    private fun showContent() {
        binding.errorView.visibility = View.GONE
        binding.swipeRefresh.visibility = View.VISIBLE
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        binding.webView.saveState(outState)
    }

    override fun onDestroy() {
        binding.webView.destroy()
        super.onDestroy()
    }
}
