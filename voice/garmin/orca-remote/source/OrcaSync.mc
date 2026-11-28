// Downloads the one track all sessions play. The watch syncs it over Wi-Fi
// (or through the phone) when "Pobierz dzwiek" is chosen in the menu.

import Toybox.Communications;
import Toybox.Lang;
import Toybox.Media;

class OrcaSyncDelegate extends Communications.SyncDelegate {
    const TRACK_URL = "https://cdn.jsdelivr.net/gh/tomaszklin/orca-voice@113a5e8e71a44009067ec510a4589abd86958dff/voice/garmin/audio/orca-remote-track.mp3";

    function initialize() {
        SyncDelegate.initialize();
    }

    function isSyncNeeded() {
        return OrcaSessions.refId() == null;
    }

    function onStartSync() {
        OrcaLog.add("pobieranie start");
        Communications.makeWebRequest(TRACK_URL, null, {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_AUDIO,
            :mediaEncoding => Media.ENCODING_MP3,
            :fileDownloadProgressCallback => method(:onProgress)
        }, method(:onTrack));
    }

    function onProgress(done, total) {
        if (total != null && total > 0) {
            Communications.notifySyncProgress((done * 100) / total);
        }
    }

    function onTrack(code, data) {
        if (code == 200 && data != null) {
            OrcaSessions.setRefId(data.getId());
            OrcaLog.add("pobrano dzwiek");
            Communications.notifySyncComplete(null);
        } else {
            OrcaLog.add("pobieranie blad " + code);
            Communications.notifySyncComplete("Blad " + code);
        }
    }

    function onStopSync() {
        Communications.cancelAllRequests();
        Communications.notifySyncComplete(null);
    }
}
