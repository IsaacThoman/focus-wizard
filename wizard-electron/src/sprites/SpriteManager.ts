import { SpriteSheet } from "./SpriteSheet";

export interface AnimatedSprite {
  sheet: SpriteSheet;
  x: number;
  y: number;
  scale?: number;
  /** Frames per second for this sprite's animation */
  fps?: number;
  /** Current column index within the active row (managed internally) */
  _col: number;
  /** Accumulated time since last frame advance (ms) */
  _elapsed: number;
  /** Whether the animation is playing */
  playing: boolean;
  /** Loop the animation */
  loop: boolean;
  /** Active row to animate across (0-based). Changes which horizontal strip is used. */
  row: number;
  /** Optional z-index for draw ordering (lower draws first) */
  z?: number;
}

export interface StaticSprite {
  image: CanvasImageSource;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Optional z-index for draw ordering (lower draws first) */
  z?: number;
}

export type ManagedSprite =
  | ({ kind: "animated" } & AnimatedSprite)
  | ({ kind: "static" } & StaticSprite);

export class SpriteManager {
  private sprites = new Map<string, ManagedSprite>();
  private canvasWidth: number;
  private canvasHeight: number;

  constructor(canvasWidth: number, canvasHeight: number) {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
  }

  addAnimated(
    id: string,
    sheet: SpriteSheet,
    x: number,
    y: number,
    options: {
      scale?: number;
      fps?: number;
      loop?: boolean;
      playing?: boolean;
      row?: number;
      z?: number;
    } = {},
  ): void {
    this.sprites.set(id, {
      kind: "animated",
      sheet,
      x,
      y,
      scale: options.scale ?? 1,
      fps: options.fps ?? 8,
      _col: 0,
      _elapsed: 0,
      playing: options.playing ?? true,
      loop: options.loop ?? true,
      row: options.row ?? 0,
      z: options.z ?? 0,
    });
  }

  addStatic(
    id: string,
    image: CanvasImageSource,
    x: number,
    y: number,
    width: number,
    height: number,
    z = 0,
  ): void {
    this.sprites.set(id, {
      kind: "static",
      image,
      x,
      y,
      width,
      height,
      z,
    });
  }

  remove(id: string): void {
    this.sprites.delete(id);
  }

  get(id: string): ManagedSprite | undefined {
    return this.sprites.get(id);
  }

  has(id: string): boolean {
    return this.sprites.has(id);
  }

  /** Update all animated sprites by the given delta time (ms). */
  update(deltaMs: number): void {
    for (const sprite of this.sprites.values()) {
      if (sprite.kind !== "animated") continue;
      if (!sprite.playing) continue;

      const frameDuration = 1000 / (sprite.fps ?? 8);
      sprite._elapsed += deltaMs;

      while (sprite._elapsed >= frameDuration) {
        sprite._elapsed -= frameDuration;
        const nextCol = sprite._col + 1;

        if (nextCol >= sprite.sheet.framesPerRow) {
          if (sprite.loop) {
            sprite._col = 0;
          } else {
            sprite.playing = false;
          }
        } else {
          sprite._col = nextCol;
        }
      }
    }
  }

  /** Draw all managed sprites to the canvas context, sorted by z-index. */
  draw(ctx: CanvasRenderingContext2D): void {
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);

    const sorted = [...this.sprites.values()].sort((a, b) =>
      (a.z ?? 0) - (b.z ?? 0)
    );

    for (const sprite of sorted) {
      if (sprite.kind === "animated") {
        // Compute the linear frame index from row + column
        const frameIndex = sprite.row * sprite.sheet.framesPerRow + sprite._col;
        sprite.sheet.drawFrame(
          ctx,
          frameIndex,
          sprite.x,
          sprite.y,
          sprite.scale,
        );
      } else {
        ctx.drawImage(
          sprite.image,
          Math.round(sprite.x),
          Math.round(sprite.y),
          sprite.width,
          sprite.height,
        );
      }
    }
  }
}
