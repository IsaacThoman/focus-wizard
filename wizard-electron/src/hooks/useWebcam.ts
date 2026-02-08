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
  /** The active media stream (for preview display) */
  stream: MediaStream | null;
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
  const [stream, setStream] = useState<MediaStream | null>(null);
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
    setStream(null);  // Clear stream state
    setIsActive(false);
  }, []);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    console.log(`[useWebcam] captureFrame called - video: ${!!video}, canvas: ${!!canvas}, readyState: ${video?.readyState}`);
    
    if (!video || !canvas || video.readyState < 2) {
      console.warn('[useWebcam] Skip frame - video not ready');
      return;
    }
    if (capturingRef.current) {
      console.warn('[useWebcam] Skip frame - previous capture in progress');
      return; // Previous capture still in flight
    }

    capturingRef.current = true;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('[useWebcam] Failed to get canvas context');
      capturingRef.current = false;
      return;
    }

    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      console.log('[useWebcam] Frame drawn to canvas');
    } catch (err) {
      console.error('[useWebcam] Error drawing to canvas:', err);
      capturingRef.current = false;
      return;
    }

    canvas.toBlob(
      (blob) => {
        capturingRef.current = false;
        if (!blob) {
          console.error('[useWebcam] Failed to create blob');
          return;
        }

        console.log(`[useWebcam] Blob created, size: ${blob.size} bytes`);
        const timestampUs = Date.now() * 1000;
        blob.arrayBuffer().then((buffer) => {
          try {
            // @ts-expect-error — injected by preload
            if (window.wizardAPI?.sendFrame) {
              window.wizardAPI.sendFrame(timestampUs, buffer);
              console.log(`[useWebcam] Frame sent: ${timestampUs}`);
            } else {
              console.error('[useWebcam] wizardAPI.sendFrame not available');
            }
          } catch (err) {
            console.error('[useWebcam] Error sending frame:', err);
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
      console.log('[useWebcam] Starting webcam capture...');

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: width },
          height: { ideal: height },
          frameRate: { ideal: fps },
        },
        audio: false,
      });

      console.log('[useWebcam] Webcam stream acquired successfully');
      streamRef.current = stream;
      setStream(stream);  // Trigger re-render for preview

      // Create video element if it doesn't exist
      if (!videoRef.current) {
        const video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        videoRef.current = video;
        console.log('[useWebcam] Video element created');
      }

      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      console.log('[useWebcam] Video element playing');

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

      console.log(`[useWebcam] Capture started at ${fps} fps`);
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
    stream,
    isActive,
    error,
    startCapture,
    stopCapture,
  };
}
