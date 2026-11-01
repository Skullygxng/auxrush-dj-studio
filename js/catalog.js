//
//  catalog.js — free, legal music from the Internet Archive
//
//  The archive hosts thousands of Creative Commons netlabel releases: real
//  artists, released for free by their labels, which is the only honest way to
//  hand a DJ named tracks inside an app. Everything here resolves to an actual
//  MP3 under a CC licence that the browser can download and decode.
//
//  Commercial releases (Fetty Wap and friends) are not in here and never will
//  be: they're not licensed for redistribution or ripping.
//

(function () {
  'use strict';

  var SEARCH = 'https://archive.org/advancedsearch.php';
  var METADATA = 'https://archive.org/metadata/';
  var DOWNLOAD = 'https://archive.org/download/';

  // Curated starting points — verified items from CC netlabels, mostly hip-hop
  // and beats, so the shelf is useful the moment it opens.
  var PICKS = [
    { identifier: 'DWK060', genre: 'Hip-hop' },
    { identifier: 'DWK046', genre: 'Hip-hop' },
    { identifier: 'DWK162', genre: 'Hip-hop' },
    { identifier: 'catrap', genre: 'Hip-hop' },
    { identifier: 'fsz023', genre: 'Hip-hop' }
  ];

  var GENRES = {
    'Hip-hop': 'hip-hop',
    'Beats': 'instrumental hip-hop',
    'House': 'house',
    'Techno': 'techno',
    'Funk': 'funk',
    'Soul': 'soul',
    'Reggae': 'reggae',
    'Drum & bass': 'drum and bass'
  };

  function jsonp(url) {
    // The archive's APIs answer plain CORS requests; no JSONP needed.
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error('archive.org ' + response.status);
      return response.json();
    });
  }

  /** Finds netlabel releases matching a free-text query and/or genre. */
  function search(query, genre) {
    var clauses = ['collection:netlabels', 'mediatype:audio'];
    if (genre) clauses.push('subject:(' + genre + ')');
    if (query) clauses.push('(' + query + ')');

    var params = [
      'q=' + encodeURIComponent(clauses.join(' AND ')),
      'fl[]=identifier',
      'fl[]=title',
      'fl[]=creator',
      'fl[]=year',
      'fl[]=subject',
      'rows=30',
      'page=1',
      'output=json'
    ];

    return jsonp(SEARCH + '?' + params.join('&')).then(function (data) {
      var docs = (data && data.response && data.response.docs) || [];
      return docs.map(function (doc) {
        return {
          identifier: doc.identifier,
          title: doc.title || doc.identifier,
          creator: Array.isArray(doc.creator) ? doc.creator[0] : (doc.creator || 'Unknown artist'),
          year: doc.year || '',
          genre: Array.isArray(doc.subject) ? doc.subject[0] : (doc.subject || '')
        };
      });
    });
  }

  /** Curated picks resolved to real item records (titles from the archive). */
  function picks() {
    return Promise.all(PICKS.map(function (pick) {
      return jsonp(METADATA + pick.identifier).then(function (data) {
        var meta = (data && data.metadata) || {};
        return {
          identifier: pick.identifier,
          title: meta.title || pick.identifier,
          creator: meta.creator || meta.artist || 'Unknown artist',
          year: (meta.date || meta.year || '').slice(0, 4),
          genre: pick.genre
        };
      }).catch(function () {
        return { identifier: pick.identifier, title: pick.identifier, creator: '', year: '', genre: pick.genre };
      });
    }));
  }

  /** Every playable MP3 in an item, with CC licence and duration. */
  function tracks(identifier) {
    return jsonp(METADATA + identifier).then(function (data) {
      var meta = (data && data.metadata) || {};
      var files = (data && data.files) || [];
      var licence = meta.licenseurl || '';

      return files.filter(function (file) {
        return file.name && /\.mp3$/i.test(file.name) &&
          /mp3/i.test(file.format || 'MP3');
      }).map(function (file) {
        var artist = file.artist || file.creator || meta.creator || meta.artist || 'Unknown artist';
        return {
          identifier: identifier,
          title: file.title || file.name.replace(/\.mp3$/i, '').replace(/_/g, ' '),
          artist: artist,
          album: file.album || meta.title || '',
          genre: file.genre || '',
          duration: Number(file.length) || 0,
          url: DOWNLOAD + identifier + '/' + encodeURIComponent(file.name),
          licence: licence
        };
      });
    });
  }

  window.AuxRushCatalog = {
    PICKS: PICKS,
    GENRES: GENRES,
    search: search,
    picks: picks,
    tracks: tracks
  };
})();


  // ------------------------------------------------------------- SoundCloud
  //
  //  SoundCloud's API needs registered OAuth credentials and most of its audio
  //  is rights-managed, so nothing here streams a track into the mixer. What we
  //  can do honestly is identify a link (public oEmbed metadata) and send you
  //  to where it plays — or, when the artist enabled downloads, to the file you
  //  can import and mix.

  function soundCloudOEmbed(url) {
    var endpoint = 'https://soundcloud.com/oembed?format=json&url=' + encodeURIComponent(url);
    return fetch(endpoint).then(function (response) {
      if (!response.ok) throw new Error('oEmbed ' + response.status);
      return response.json();
    }).then(function (data) {
      return {
        title: data.title || '',
        artist: data.author_name || '',
        artwork: data.thumbnail_url || ''
      };
    });
  }

  /** True for a SoundCloud track/playlist link. */
  function isSoundCloudUrl(text) {
    return /^(https?:\/\/)?(www\.|m\.)?soundcloud\.com\/[^\s]+$/i.test(String(text || '').trim());
  }

  /** Reads the metadata; falls back to the link's slug if oEmbed is blocked. */
  function soundCloudInfo(url) {
    var clean = String(url).trim().replace(/^http:/, 'https:');
    if (!/^https?:\/\//i.test(clean)) clean = 'https://' + clean;

    return soundCloudOEmbed(clean).catch(function () {
      var slug = clean.replace(/[?#].*$/, '').split('/').pop() || 'SoundCloud track';
      return {
        title: slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }),
        artist: (clean.split('/')[3] || 'SoundCloud'),
        artwork: ''
      };
    });
  }

  window.AuxRushCatalog.soundCloudInfo = soundCloudInfo;
  window.AuxRushCatalog.isSoundCloudUrl = isSoundCloudUrl;

  // ----------------------------------------------------------------- Spotify
  //
  //  A Spotify account licenses personal listening inside Spotify's own apps,
  //  not playback through another application, and its audio is DRM-locked
  //  away from Web Audio. So a link is catalogued here — title and artwork via
  //  public oEmbed — and plays where it is licensed to.

  function isSpotifyUrl(text) {
    return /^(https?:\/\/)?(open\.)?spotify\.com\/[^\s]+$/i.test(String(text || '').trim());
  }

  function spotifyInfo(url) {
    var clean = String(url).trim();
    if (!/^https?:\/\//i.test(clean)) clean = 'https://' + clean;

    var endpoint = 'https://open.spotify.com/oembed?url=' + encodeURIComponent(clean);
    return fetch(endpoint).then(function (response) {
      if (!response.ok) throw new Error('oEmbed ' + response.status);
      return response.json();
    }).then(function (data) {
      return {
        title: data.title || '',
        artist: 'Spotify',
        artwork: data.thumbnail_url || ''
      };
    }).catch(function () {
      var id = (clean.split('/').pop() || '').split('?')[0];
      return {
        title: 'Spotify track' + (id ? ' ' + id.slice(0, 8) : ''),
        artist: 'Spotify',
        artwork: ''
      };
    });
  }

  window.AuxRushCatalog.isSpotifyUrl = isSpotifyUrl;
  window.AuxRushCatalog.spotifyInfo = spotifyInfo;
