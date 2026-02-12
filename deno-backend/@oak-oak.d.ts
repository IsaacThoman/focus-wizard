// Type declarations for @oak/oak (Deno JSR package)
declare module "@oak/oak" {
  export class Application {
    use(middleware: any): void;
    listen(options: { port: number }): Promise<void>;
  }

  export interface RouterOptions {
    prefix?: string;
  }

  export class Router {
    constructor(options?: RouterOptions);
    use(middleware: any): Router;
    get(path: string, ...middleware: any[]): Router;
    post(path: string, ...middleware: any[]): Router;
    put(path: string, ...middleware: any[]): Router;
    delete(path: string, ...middleware: any[]): Router;
    routes(): any;
    allowedMethods(): any;
  }

  export enum Status {
    OK = 200,
    Created = 201,
    NoContent = 204,
    BadRequest = 400,
    Unauthorized = 401,
    Forbidden = 403,
    NotFound = 404,
    InternalServerError = 500,
    BadGateway = 502,
  }

  export interface Context {
    request: {
      method: string;
      url: URL;
      body: {
        json(): Promise<any>;
        text(): Promise<string>;
      };
    };
    response: {
      status: Status | number;
      body: any;
      headers: Headers;
      type: string;
    };
  }
}
