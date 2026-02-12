// Deno global type declarations for IDE support

declare global {
  namespace Deno {
    namespace env {
      function get(key: string): string | undefined;
    }

    namespace errors {
      class NotFound extends Error {}
    }

    function readTextFile(path: string | URL): Promise<string>;
    function writeTextFile(path: string | URL, data: string): Promise<void>;
    function stat(path: string | URL): Promise<FileInfo>;

    interface FileInfo {
      isFile: boolean;
      isDirectory: boolean;
      isSymlink: boolean;
      size: number;
      mtime: Date | null;
      atime: Date | null;
      birthtime: Date | null;
      dev: number;
      ino: number | null;
      mode: number | null;
      nlink: number | null;
      uid: number | null;
      gid: number | null;
      rdev: number | null;
      blksize: number | null;
      blocks: number | null;
    }
  }

  var Deno: typeof Deno;

  interface ImportMeta {
    main: boolean;
    url: string;
  }
}

export {};
