/**
 * useWebcam.ts — React hook for webcam capture & frame streaming
 *
 * Manages getUserMedia, draws video frames to an offscreen canvas,
 * converts to JPEG, and sends them to the Electron main process
 * which writes them to the shared Docker volume.
 */

import { useRef, useState, useEffect, useCallback } from 'react';

interface UseWebcamOptions {
  /** Desired capture width (default: 640) */
  width?: number;
  /** Desired capture height (default: 480) */
  height?: number;
  /** Frames per second to capture (default: 15) */
  fps?: number;
  /** JPEG quality 0-1 (default: 0.80) */
  quality?: number;
  /** Whether capture is enabled */
  enabled?: boolean;
}

interface UseWebcamReturn {
  /** Ref to attach to a <video> element for live preview */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Whether the webcam is actively streaming */
  isActive: boolean;
  /** Error message if webcam access failed */
  error: string | null;
  /** Manually start capture */
  startCapture: () => Promise<void>;
  /** Manually stop capture */
  stopCapture: () => void;
}

export function useWebcam(options: UseWebcamOptions = {}): UseWebcamReturn {
  const {
    width = 640,
    height = 480,
    fps = 15,
    quality = 0.80,
    enabled = false,
  } = options;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const capturingRef = useRef(false); // Guard against overlapping captures

  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopCapture = useCallback(() => {
    // Stop the capture interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Stop all media tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // Disconnect video element
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    canvasRef.current = null;
    capturingRef.current = false;
    setIsActive(false);
  }, []);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    if (capturingRef.current) return; // Previous capture still in flight

    capturingRef.current = true;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      capturingRef.current = false;
      return;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        capturingRef.current = false;
        if (!blob) return;

        const timestampUs = Date.now() * 1000;
        blob.arrayBuffer().then((buffer) => {
          try {
            // @ts-expect-error — injected by preload
            window.wizardAPI?.sendFrame(timestampUs, buffer);
          } catch {
            // Preload API not available (not in Electron)
          }
        });
      },
      'image/jpeg',
      quality,
    );
  }, [quality]);

  const startCapture = useCallback(async () => {
    try {
      setError(null);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: width },
          height: { ideal: height },
          frameRate: { ideal: fps },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Create offscreen canvas for frame extraction
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvasRef.current = canvas;

      // Start the capture interval
      const intervalMs = Math.round(1000 / fps);
      intervalRef.current = setInterval(() => {
        captureFrame();
      }, intervalMs);

      setIsActive(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to access webcam';
      setError(message);
      console.error('[useWebcam] Error:', message);
    }
  }, [width, height, fps, captureFrame]);

  // Auto-start/stop based on `enabled` prop
  useEffect(() => {
    if (enabled) {
      startCapture();
    } else {
      stopCapture();
    }

    return () => {
      stopCapture();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return {
    videoRef,
    isActive,
    error,
    startCapture,
    stopCapture,
  };
}
