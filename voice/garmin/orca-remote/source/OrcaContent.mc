// The player side: every session is the same downloaded track under the
// session's name. Moving through the list and the buttons become signals.

import Toybox.Lang;
import Toybox.Media;

class OrcaContentDelegate extends Media.ContentDelegate {
    var _iterator;

    function initialize() {
        ContentDelegate.initialize();
        _iterator = new OrcaContentIterator();
        OrcaLog.add("odtwarzacz start");
    }

    function getContentIterator() {
        return _iterator;
    }

    function resetContentIterator() {
        _iterator = new OrcaContentIterator();
        return _iterator;
    }

    function onSong(refId, songEvent, playbackPosition) {
        var name = songEventName(songEvent);
        if (songEvent == Media.SONG_EVENT_PAUSE || songEvent == Media.SONG_EVENT_RESUME) {
            OrcaSignal.send(name, OrcaSessions.current());
        } else {
            OrcaLog.add("utwor " + name);
        }
    }

    function onThumbsUp(refId) {
        OrcaSignal.send("kciuk-gora", OrcaSessions.current());
    }

    function onThumbsDown(refId) {
        OrcaSignal.send("kciuk-dol", OrcaSessions.current());
    }

    function onShuffle() {
        OrcaSignal.send("losowo", OrcaSessions.current());
    }

    function onRepeat() {
        OrcaSignal.send("powtorz", OrcaSessions.current());
    }

    function songEventName(e) {
        switch (e) {
            case Media.SONG_EVENT_START: return "start";
            case Media.SONG_EVENT_SKIP_NEXT: return "skip-nastepny";
            case Media.SONG_EVENT_SKIP_PREVIOUS: return "skip-poprzedni";
            case Media.SONG_EVENT_PLAYBACK_NOTIFY: return "gra";
            case Media.SONG_EVENT_COMPLETE: return "koniec";
            case Media.SONG_EVENT_STOP: return "stop";
            case Media.SONG_EVENT_PAUSE: return "pauza";
            case Media.SONG_EVENT_RESUME: return "wznow";
            case Media.SONG_EVENT_SKIP_FORWARD: return "do-przodu";
            case Media.SONG_EVENT_SKIP_BACKWARD: return "do-tylu";
        }
        return "zdarzenie-" + e;
    }
}

class OrcaContentIterator extends Media.ContentIterator {

    function initialize() {
        ContentIterator.initialize();
    }

    function canSkip() {
        return true;
    }

    function shuffling() {
        return false;
    }

    function repeatMode() {
        return Media.REPEAT_MODE_ONE;
    }

    function get() {
        return content(OrcaSessions.index());
    }

    function next() {
        var i = OrcaSessions.wrap(OrcaSessions.index() + 1);
        OrcaSessions.setIndex(i);
        OrcaSignal.send("nastepna", OrcaSessions.name(i));
        return content(i);
    }

    function previous() {
        var i = OrcaSessions.wrap(OrcaSessions.index() - 1);
        OrcaSessions.setIndex(i);
        OrcaSignal.send("poprzednia", OrcaSessions.name(i));
        return content(i);
    }

    function peekNext() {
        return content(OrcaSessions.wrap(OrcaSessions.index() + 1));
    }

    function peekPrevious() {
        return content(OrcaSessions.wrap(OrcaSessions.index() - 1));
    }

    function getPlaybackProfile() {
        var profile = new Media.PlaybackProfile();
        profile.playbackControls = [
            Media.PLAYBACK_CONTROL_PREVIOUS,
            Media.PLAYBACK_CONTROL_PLAYBACK,
            Media.PLAYBACK_CONTROL_NEXT,
            Media.PLAYBACK_CONTROL_RATING,
            Media.PLAYBACK_CONTROL_VOLUME
        ];
        profile.playbackNotificationThreshold = 0;
        profile.requirePlaybackNotification = false;
        profile.attemptSkipAfterThumbsDown = false;
        // Back always moves to the previous session instead of restarting the track.
        profile.skipPreviousThreshold = 100000;
        return profile;
    }

    function content(i) {
        var id = OrcaSessions.refId();
        if (id == null) {
            OrcaLog.add("brak dzwieku, zrob Pobierz");
            return null;
        }
        var metadata = new Media.ContentMetadata();
        metadata.title = OrcaSessions.name(i);
        metadata.artist = "Orca";
        metadata.album = "Sesja " + (i + 1) + "/" + OrcaSessions.count();
        metadata.trackNumber = i + 1;
        return new Media.ActiveContent(new Media.ContentRef(id, Media.CONTENT_TYPE_AUDIO), metadata, 0);
    }
}
