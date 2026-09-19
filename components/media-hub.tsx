"use client";

import React, { useState, useEffect } from "react";
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Volume2,
  VolumeX,
  Search,
  ExternalLink,
  Music,
  Radio,
  Sparkles,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import styles from "./media-hub.module.css";

interface PresetTrack {
  id: string;
  title: string;
  artist: string;
  query: string;
  videoId?: string;
}

const PRESET_TRACKS: PresetTrack[] = [
  {
    id: "arj_kiya_hai",
    title: "Arj Kiya Hai",
    artist: "Coke Studio Pakistan",
    query: "arj kiya hai coke studio",
    videoId: "bP8ATWCvqzw",
  },
  {
    id: "hawayein",
    title: "Hawayein",
    artist: "Arijit Singh · Jab Harry Met Sejal",
    query: "hawayein arijit singh",
    videoId: "CvgXk1lQvFw",
  },
  {
    id: "lofi_beats",
    title: "Lofi Hip Hop Radio",
    artist: "Lofi Girl · Beats to Relax/Study to",
    query: "lofi hip hop radio beats to relax study to",
    videoId: "jfKfPfyJRdk",
  },
  {
    id: "synthwave",
    title: "Synthwave Radio",
    artist: "ChillSynth FM · Retro 80s",
    query: "synthwave radio live chill synth",
    videoId: "4xDzrJKXOOY",
  },
  {
    id: "ai_papers",
    title: "Agentic AI Frontier Walkthrough",
    artist: "AI Research Briefing",
    query: "autonomous AI agents anthropic computer use architecture",
  },
  {
    id: "classical",
    title: "Focus Classical Masterpieces",
    artist: "Deep Work Symphony",
    query: "classical music for focus and concentration",
  },
];

export function MediaHub() {
  const [query, setQuery] = useState("");
  const [currentTrack, setCurrentTrack] = useState<PresetTrack | null>(PRESET_TRACKS[0]);
  const [activeVideoId, setActiveVideoId] = useState<string>("bP8ATWCvqzw");
  const [isLoading, setIsLoading] = useState(false);
  const [systemVolume, setSystemVolume] = useState<number>(50);
  const [isMuted, setIsMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Load system volume status on mount
  useEffect(() => {
    fetch("/api/system")
      .then((res) => res.json())
      .then((data) => {
        if (data.volume) {
          setSystemVolume(data.volume.volume ?? 50);
          setIsMuted(Boolean(data.volume.muted));
        }
      })
      .catch(() => {});
  }, []);

  const showToast = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 3000);
  };

  const playSong = async (searchQuery: string, presetVideoId?: string) => {
    if (!searchQuery.trim()) return;
    setIsLoading(true);
    showToast(`Streaming "${searchQuery}"…`);

    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "play_media", query: searchQuery.trim() }),
      });

      const data = await res.json();
      if (data.ok && data.media) {
        const vid = data.media.videoId || presetVideoId;
        if (vid) {
          setActiveVideoId(vid);
        }
        setIsPlaying(true);
        if (data.media.url) {
          try {
            window.open(data.media.url, "_blank", "noopener,noreferrer");
          } catch {}
        }
        showToast(`Now playing on workstation & browser!`);
      }
    } catch {
      showToast(`Playback request sent`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setCurrentTrack({
      id: `custom_${Date.now()}`,
      title: query,
      artist: "YouTube Stream",
      query,
    });
    playSong(query);
  };

  const handleMediaKey = async (media: "play" | "pause" | "toggle" | "next" | "previous") => {
    try {
      await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "media_key", media }),
      });
      if (media === "pause") setIsPlaying(false);
      if (media === "play") setIsPlaying(true);
      if (media === "toggle") setIsPlaying((prev) => !prev);
      showToast(`Hardware media key sent: ${media}`);
    } catch {}
  };

  const handleVolumeStep = async (delta: number) => {
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "volume_step", delta }),
      });
      const data = await res.json();
      if (data.volume) {
        setSystemVolume(data.volume.volume);
        setIsMuted(data.volume.muted);
        showToast(`Workstation volume: ${data.volume.volume}%`);
      }
    } catch {}
  };

  const handleMuteToggle = async () => {
    const next = !isMuted;
    try {
      const res = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_mute", muted: next }),
      });
      const data = await res.json();
      if (data.volume) {
        setIsMuted(data.volume.muted);
        showToast(data.volume.muted ? "Muted" : "Unmuted");
      }
    } catch {}
  };

  return (
    <div className={styles.mediaHubRoot}>
      {/* Top Heading */}
      <div className="page-heading reveal">
        <div>
          <p className="eyebrow">Workstation Entertainment & Audio Motor</p>
          <h1>Media Hub</h1>
          <p className="page-description">
            Zero-latency YouTube and audio playback, real-time hardware transport keys, and workstation audio control.
          </p>
        </div>
        {feedback && (
          <div className="stat-chip" style={{ background: "rgba(16,185,129,0.15)", borderColor: "rgba(16,185,129,0.4)", color: "#34d399" }}>
            <CheckCircle2 size={13} style={{ marginRight: "6px" }} />
            <span>{feedback}</span>
          </div>
        )}
      </div>

      {/* Hero Player & Control Deck */}
      <section className={styles.heroPlayerCard}>
        {/* Left: Embedded YouTube Viewport */}
        <div className={styles.playerViewport}>
          {activeVideoId ? (
            <iframe
              className={styles.playerIframe}
              src={`https://www.youtube.com/embed/${activeVideoId}?autoplay=1&enablejsapi=1`}
              title="YouTube video player"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <div className={styles.emptyPlayer}>
              <Music size={42} style={{ color: "#38bdf8" }} />
              <h3>No track selected</h3>
              <p>Pick a track below or search for any song to start real-time playback.</p>
            </div>
          )}
        </div>

        {/* Right: Search, Track Info, Hardware Controls */}
        <div className={styles.controlSidePanel}>
          <div>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#38bdf8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
              Now Playing / Queue
            </div>
            <h2 style={{ margin: "0 0 4px", fontSize: "18px", color: "#f8fafc" }}>
              {currentTrack?.title || "Workstation Audio Stream"}
            </h2>
            <p style={{ margin: "0 0 14px", fontSize: "12px", color: "#94a3b8" }}>
              {currentTrack?.artist || "YouTube Live"}
            </p>

            {/* Instant Search Bar */}
            <form onSubmit={handleSearch} className={styles.searchForm}>
              <Search size={15} style={{ color: "#64748b" }} />
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search any song or artist (e.g. Arj Kiya Hai)..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button type="submit" className={styles.searchBtn} disabled={isLoading}>
                {isLoading ? <Loader2 size={13} className="spin" /> : <Play size={13} />}
                <span>Play</span>
              </button>
            </form>
          </div>

          {/* Hardware Media Transport Controls */}
          <div className={styles.hardwareTransportBar}>
            <div className={styles.transportButtons}>
              <button
                type="button"
                className={styles.transportBtn}
                onClick={() => handleMediaKey("previous")}
                title="Previous Track"
              >
                <SkipBack size={16} />
              </button>
              <button
                type="button"
                className={styles.transportBtn}
                style={{ background: "linear-gradient(135deg, #0284c7, #2563eb)", color: "#ffffff" }}
                onClick={() => handleMediaKey("toggle")}
                title="Play / Pause"
              >
                {isPlaying ? <Pause size={17} /> : <Play size={17} />}
              </button>
              <button
                type="button"
                className={styles.transportBtn}
                onClick={() => handleMediaKey("next")}
                title="Next Track"
              >
                <SkipForward size={16} />
              </button>
            </div>

            {/* Volume Knobs */}
            <div className={styles.volumeControls}>
              <button
                type="button"
                className={styles.transportBtn}
                onClick={handleMuteToggle}
                title={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? <VolumeX size={15} style={{ color: "#f43f5e" }} /> : <Volume2 size={15} />}
              </button>
              <button
                type="button"
                className="text-button"
                style={{ fontSize: "11px", padding: "4px 8px" }}
                onClick={() => handleVolumeStep(-10)}
                title="Decrease Volume (-10)"
              >
                -10
              </button>
              <span style={{ fontSize: "12px", fontWeight: 700, minWidth: "36px", textAlign: "center" }}>
                {systemVolume}%
              </span>
              <button
                type="button"
                className="text-button"
                style={{ fontSize: "11px", padding: "4px 8px" }}
                onClick={() => handleVolumeStep(10)}
                title="Increase Volume (+10)"
              >
                +10
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Preset / Instant Play Track Grid */}
      <section>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
          <Radio size={16} style={{ color: "#38bdf8" }} />
          <h3 style={{ margin: 0, fontSize: "15px", color: "#f8fafc" }}>Quick Playlists & Instant Tracks</h3>
        </div>

        <div className={styles.presetGrid}>
          {PRESET_TRACKS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={styles.trackCard}
              onClick={() => {
                setCurrentTrack(t);
                if (t.videoId) setActiveVideoId(t.videoId);
                playSong(t.query, t.videoId);
              }}
            >
              <div className={styles.trackIcon}>
                <Play size={16} />
              </div>
              <div className={styles.trackInfo}>
                <span className={styles.trackTitle}>{t.title}</span>
                <span className={styles.trackArtist}>{t.artist}</span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
