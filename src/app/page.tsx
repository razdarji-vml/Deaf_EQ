"use client";

import { useRef, useState, useEffect } from "react";
import { motion, useSpring } from "framer-motion";
import Image from "next/image";

// ===== Chart.js bits (same API as your manager's) =====
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { ChartData, ChartOptions, ScriptableContext, ChartArea } from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// ---- Graph (light UI like your original) ----
interface EQGraphProps {
  isBassHeavy: boolean;
}
export function EQGraph({ isBassHeavy }: EQGraphProps) {
  const flatData = [0, 0, 0, 0, 0, 0];
  const bassHeavyData = [12, 10, 4, -6, -8, -12];

  const data: ChartData<'line'> = {
    labels: ["60Hz", "150Hz", "250Hz", "1kHz", "4kHz", "15kHz"],
    datasets: [
      {
        label: "EQ Levels",
        data: isBassHeavy ? bassHeavyData : flatData,
        fill: true,
        backgroundColor: (context: ScriptableContext<'line'>): CanvasGradient | string | undefined => {
          const chart = context.chart;
          const ctx: CanvasRenderingContext2D | undefined = chart?.ctx;
          const chartArea: ChartArea | undefined = chart?.chartArea;
          if (!ctx || !chartArea) return;
          const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          g.addColorStop(0, "rgba(0,0,0,0.8)");
          g.addColorStop(1, "rgba(0,0,0,0.1)");
          return g;
        },
        borderColor: "#000",
        borderWidth: 2,
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: "#000",
        pointBorderColor: "#000",
      },
    ],
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      y: {
        min: -12,
        max: 12,
        grid: { color: "rgba(0,0,0,0.2)" },
        ticks: {
          color: "#000",
          callback: (v: string | number) => `${v} dB`,
        },
      },
      x: {
        grid: { color: "rgba(0,0,0,0.2)" },
        ticks: { color: "#000" },
      },
    },
  };

  return <Line data={data} options={options} />;
}

// =================== PAGE ===================
export default function Page() {
  // UI state
  const [eqOn, setEqOn] = useState(false); // false = Normal, true = Deaf EQ
  const visual = useSpring(0, { stiffness: 180, damping: 26 });
  const [isPlaying, setIsPlaying] = useState(false);

  // keep spring in sync with toggle
  useEffect(() => {
    visual.set(eqOn ? 1 : 0);
  }, [eqOn, visual]);

  // ===== Web Audio (from your manager's working code), adapted =====
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const filtersRef = useRef<BiquadFilterNode[]>([]);
  const bufferRef = useRef<AudioBuffer | null>(null);

  // load & set up graph once
  useEffect(() => {
    let mounted = true;

    async function loadAudio() {
      try {
        const res = await fetch("/OFF_deaf_eq.mp3");
        const arrayBuffer = await res.arrayBuffer();
        const ctx = new (
          window.AudioContext ||
          ('webkitAudioContext' in window ? (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext : undefined)
        )();
        if (!mounted) return;
        audioContextRef.current = ctx;

        const buffer = await ctx.decodeAudioData(arrayBuffer);
        if (!mounted) return;
        bufferRef.current = buffer;

        // Create 6 peaking filters at the graph frequencies
        const freqs = [60, 150, 250, 1000, 4000, 15000];
        const filters: BiquadFilterNode[] = freqs.map((f) => {
          const flt = ctx.createBiquadFilter();
          flt.type = "peaking";
          flt.frequency.value = f;
          flt.Q.value = 1;
          flt.gain.value = 0; // start flat
          return flt;
        });

        // Chain filters then to destination
        filters.reduce((prev, curr) => {
          prev.connect(curr);
          return curr;
        });
        filters[filters.length - 1].connect(ctx.destination);
        filtersRef.current = filters;
      } catch (e) {
        console.error("Error loading audio:", e);
      }
    }

    loadAudio();
    return () => {
      mounted = false;
      try {
        sourceRef.current?.stop();
      } catch {}
      audioContextRef.current?.close();
    };
  }, []);

  // Smoothly set EQ gains whenever eqOn changes
  useEffect(() => {
    const ctx = audioContextRef.current;
    if (!ctx || !filtersRef.current.length) return;

    const gains = eqOn ? [12, 10, 4, -6, -8, -12] : [0, 0, 0, 0, 0, 0];
    const now = ctx.currentTime;
    filtersRef.current.forEach((filter, i) => {
      // setTargetAtTime = nice short fade
      filter.gain.setTargetAtTime(gains[i], now, 0.12);
    });
  }, [eqOn]);

  // Start/stop playback from the card button
  const togglePlay = async () => {
    const ctx = audioContextRef.current;
    const buffer = bufferRef.current;
    if (!ctx || !buffer || !filtersRef.current.length) return;

    if (isPlaying) {
      try {
        sourceRef.current?.stop();
      } catch {}
      sourceRef.current = null;
      setIsPlaying(false);
      return;
    }

    // iOS requires resume after gesture
    await ctx.resume();

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(filtersRef.current[0]);
    source.start();
    sourceRef.current = source;
    setIsPlaying(true);
  };

  // Responsive toggle position
  const [toggleRight, setToggleRight] = useState(125);
  useEffect(() => {
    function handleResize() {
      setToggleRight(window.innerWidth < 640 ? 100 : 125);
    }
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        background: "#ECECEC",
        color: "#111",
        padding: "2.5rem",
      }}
    >
      {/* Header */}
      <header
        className="flex flex-col items-center justify-center text-center gap-6 mb-8 px-2"
      >
        <h1
          className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-gray-300 leading-tight m-0 text-center"
        >
          DEAF EQ<br />SIMULATOR
        </h1>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="text-base sm:text-lg md:text-xl font-bold m-0 text-center"
        >
          AN EQ SETTING THAT IS OPTIMISED FOR<br />DEAF PEOPLE
        </motion.p>
      </header>

      {/* Graph */}
      <section className="mx-auto w-full max-w-2xl min-h-60 px-2 mb-2">
        <EQGraph isBassHeavy={eqOn} />
      </section>

      {/* Play Track Card - responsive, always single row */}
      <div className="flex items-center justify-center w-full px-2 mb-6">
        <div className="flex flex-row items-center justify-between bg-gray-200 p-2 sm:p-3 rounded-md w-full max-w-md gap-x-3">
          <div className="flex items-center space-x-2 sm:space-x-3 w-auto">
            <Image
              src="/Kendrick_Lamar_-_Not_Like_Us.png"
              alt="Track thumbnail"
              width={50}
              height={50}
              className="rounded-sm object-cover"
            />
            <span className="text-black font-medium text-base sm:text-lg">
              {isPlaying ? "playing…" : "play track"}
            </span>
          </div>

          <button
            onClick={togglePlay}
            className="p-2 rounded-md hover:bg-black/5 active:scale-95"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            <Image
              src="/play-button-arrowhead.png"
              alt="Play icon"
              width={28}
              height={28}
            />
          </button>
        </div>
      </div>

      {/* Toggle row - responsive */}
      <footer
        className="flex justify-center items-center gap-4 pb-6 px-2 w-full"
      >
        <span className="text-base sm:text-lg" style={{ opacity: eqOn ? 0.4 : 1 }}>Normal EQ</span>
        <button
          aria-pressed={eqOn}
          aria-label={eqOn ? "Disable Deaf EQ" : "Enable Deaf EQ"}
          onClick={() => setEqOn((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") setEqOn((v) => !v);
          }}
          className="relative w-44 h-14 rounded-full border border-gray-400 bg-gradient-to-r from-gray-300 to-gray-200"
        >
          <motion.div
            layout
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            style={{
              position: "absolute",
              top: 6,
              left: eqOn ? toggleRight : 6,
              width: 44,
              height: 44,
              borderRadius: 999,
              background: "#fff",
              boxShadow: "0 3px 10px rgba(0,0,0,.15)",
            }}
          />
        </button>
        <span
          className="font-extrabold text-base sm:text-lg"
          style={{ color: "#8E5BFF", opacity: eqOn ? 1 : 0.5 }}
        >
          Deaf EQ
        </span>
      </footer>
    </main>
  );
}
