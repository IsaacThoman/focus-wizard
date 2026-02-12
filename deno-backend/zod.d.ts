// Type declarations for zod (npm package via Deno)
declare module "zod" {
  export interface ZodError {
    issues: any[];
  }

  export type SafeParseSuccess<T> = { success: true; data: T };
  export type SafeParseError = { success: false; error: ZodError };
  export type SafeParseReturnType<T> = SafeParseSuccess<T> | SafeParseError;

  export class ZodType<T = any> {
    parse(data: unknown): T;
    safeParse(data: unknown): SafeParseReturnType<T>;
    optional(): ZodType<T | undefined>;
    nullable(): ZodType<T | null>;
  }

  export class ZodObject<T = any> extends ZodType<T> {
    parse(data: unknown): T;
    safeParse(data: unknown): SafeParseReturnType<T>;
  }

  export class ZodString extends ZodType<string> {
    min(length: number, message?: string): this;
    max(length: number, message?: string): this;
    datetime(options?: { offset?: boolean; precision?: number }): this;
    optional(): ZodType<string | undefined>;
    nullable(): ZodType<string | null>;
  }

  export class ZodNumber extends ZodType<number> {
    min(value: number): this;
    max(value: number): this;
    optional(): ZodType<number | undefined>;
    nullable(): ZodType<number | null>;
  }

  export class ZodBoolean extends ZodType<boolean> {}
  export class ZodArray<T = any> extends ZodType<T[]> {}

  export namespace z {
    export function object<T>(shape: any): ZodObject<T>;
    export function string(): ZodString;
    export function number(): ZodNumber;
    export function boolean(): ZodBoolean;
    export function array<T>(schema: ZodType<T>): ZodArray<T>;
    export type infer<T extends ZodType<any>> = T extends ZodType<infer U> ? U : never;
  }

  export const z: typeof z;
}
