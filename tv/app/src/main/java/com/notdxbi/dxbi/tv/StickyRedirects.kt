package com.notdxbi.dxbi.tv

import android.net.Uri
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap

/**
 * A link that leads on to the file is followed once a play. A debrid stream's address is the addon's
 * own (Torrentio's "resolve" link), which asks the debrid service for the file's real address and
 * sends the player there. Every seek outside what is loaded opens the file again, and going by the
 * addon each time had it ask the service each time: a few skips in a row are a burst of requests,
 * which a service answers with its "limit reached" clip, or not at all, in place of the film. The
 * player then found another file's bytes in the middle of this one, and the play ended.
 *
 * Where a link landed is kept for as long as the player lives, and used for every later opening of
 * that link. When the kept address stops answering (such links run out), the link itself is tried
 * again, as before.
 */
@OptIn(UnstableApi::class)
class StickyRedirects(private val upstream: DataSource.Factory) : DataSource.Factory {
    private val landed = ConcurrentHashMap<Uri, Uri>()

    override fun createDataSource(): DataSource = Source(upstream.createDataSource())

    private inner class Source(private val source: DataSource) : DataSource {
        override fun addTransferListener(transferListener: TransferListener) = source.addTransferListener(transferListener)

        override fun open(dataSpec: DataSpec): Long {
            val asked = dataSpec.uri
            val web = asked.scheme == "http" || asked.scheme == "https"
            val known = if (web) landed[asked] else null
            if (known != null) {
                try {
                    return source.open(dataSpec.withUri(known))
                } catch (e: IOException) {
                    landed.remove(asked)
                    try { source.close() } catch (_: IOException) { /* not open */ }
                    Log.i("dxbi", "the kept address of a stream stopped answering (${e.javaClass.simpleName}): its link is followed again")
                }
            }
            val length = source.open(dataSpec)
            val now = source.uri
            if (web && now != null && now != asked && landed.size < MAX_KEPT) {
                if (landed.put(asked, now) == null) Log.i("dxbi", "a stream's link leads on to ${now.host}: kept for this play")
            }
            return length
        }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int = source.read(buffer, offset, length)
        override fun getUri(): Uri? = source.uri
        override fun getResponseHeaders(): Map<String, List<String>> = source.responseHeaders
        override fun close() = source.close()
    }

    private companion object {
        // (the video, and the subtitle files an addon offers by way of its own address)
        const val MAX_KEPT = 64
    }
}
