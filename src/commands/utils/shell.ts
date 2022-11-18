'use strict';

import * as shelljs from 'shelljs';
import * as path from 'path';
import * as vscode from 'vscode';

import * as config from './config/config';
import { Errorable } from './errorable';

export enum Platform {
   Windows,
   MacOS,
   Linux,
   Unsupported // shouldn't happen!
}

export interface ExecOpts {
   readonly cwd?: string;
}

export interface Shell {
   isWindows(): boolean;
   isUnix(): boolean;
   platform(): Platform;
   home(): string;
   combinePath(basePath: string, relativePath: string): string;
   fileUri(filePath: string): vscode.Uri;
   execOpts(): any;
   exec(cmd: string, stdin?: string): Promise<Errorable<ShellResult>>;
   execObj<T>(
      cmd: string,
      cmdDesc: string,
      opts: ExecOpts,
      fn: (stdout: string) => T
   ): Promise<Errorable<T>>;
   execCore(cmd: string, opts: any, stdin?: string): Promise<ShellResult>;
   execToFile(cmd: string, dest: string, opts: any): Promise<ShellResult>;
   unquotedPath(path: string): string;
}

export const shell: Shell = {
   isWindows: isWindows,
   isUnix: isUnix,
   platform: platform,
   home: home,
   combinePath: combinePath,
   fileUri: fileUri,
   execOpts: execOpts,
   exec: exec,
   execObj: execObj,
   execCore: execCore,
   execToFile: execToFile,
   unquotedPath: unquotedPath
};

const WINDOWS: string = 'win32';

export interface ShellResult {
   readonly code: number;
   readonly stdout: string;
   readonly stderr: string;
}

export type ShellHandler = (
   code: number,
   stdout: string,
   stderr: string
) => void;

function isWindows(): boolean {
   return process.platform === WINDOWS;
}

function isUnix(): boolean {
   return !isWindows();
}

function platform(): Platform {
   switch (process.platform) {
      case 'win32':
         return Platform.Windows;
      case 'darwin':
         return Platform.MacOS;
      case 'linux':
         return Platform.Linux;
      default:
         return Platform.Unsupported;
   }
}

function home(): string {
   return process.env['HOME'] || process.env['USERPROFILE'] || '';
}

function combinePath(basePath: string, relativePath: string) {
   let separator = '/';
   if (isWindows()) {
      relativePath = relativePath.replace(/\//g, '\\');
      separator = '\\';
   }
   return basePath + separator + relativePath;
}

function fileUri(filePath: string): vscode.Uri {
   if (isWindows()) {
      return vscode.Uri.parse('file:///' + filePath.replace(/\\/g, '/'));
   }
   return vscode.Uri.parse('file://' + filePath);
}

function execOpts(): any {
   let env = process.env;
   if (isWindows()) {
      env = Object.assign({}, env, {HOME: home()});
   }
   env = shellEnvironment(env);
   const opts = {
      cwd: vscode.workspace.rootPath,
      env: env,
      async: true
   };
   return opts;
}

async function exec(
   cmd: string,
   stdin?: string
): Promise<Errorable<ShellResult>> {
   try {
      return {succeeded: true, result: await execCore(cmd, execOpts(), stdin)};
   } catch (ex) {
      return {succeeded: false, error: `Error invoking '${cmd}: ${ex}`};
   }
}

async function execObj<T>(
   cmd: string,
   cmdDesc: string,
   opts: ExecOpts,
   fn: (stdout: string) => T
): Promise<Errorable<T>> {
   const o = Object.assign({}, execOpts(), opts);
   try {
      const sr = await execCore(cmd, o);
      if (sr.code === 0) {
         const value = fn(sr.stdout);
         return {succeeded: true, result: value};
      } else {
         return {succeeded: false, error: `${cmdDesc} error: ${sr.stderr}`};
      }
   } catch (ex) {
      return {succeeded: false, error: `Error invoking '${cmd}: ${ex}`};
   }
}

function execCore(
   cmd: string,
   opts: any,
   stdin?: string
): Promise<ShellResult> {
   return new Promise<ShellResult>((resolve, reject) => {
      const proc = shelljs.exec(cmd, opts, (code, stdout, stderr) =>
         resolve({code: code, stdout: stdout, stderr: stderr})
      );
      if (stdin) {
         proc.stdin!.end(stdin);
      }
   });
}

function execToFile(
   cmd: string,
   dest: string,
   opts: any
): Promise<ShellResult> {
   return new Promise<ShellResult>((resolve, reject) => {
      shelljs.exec(cmd + ` >${dest}`, opts, (code, stdout, stderr) =>
         resolve({code: code, stdout: stdout, stderr: stderr})
      );
   });
}

function unquotedPath(path: string): string {
   if (
      isWindows() &&
      path &&
      path.length > 1 &&
      path.startsWith('"') &&
      path.endsWith('"')
   ) {
      return path.substring(1, path.length - 1);
   }
   return path;
}

export function shellEnvironment(baseEnvironment: any): any {
   const env = Object.assign({}, baseEnvironment);
   const pathVariable = pathVariableName(env);
   for (const tool of ['duffle']) {
      const toolPath = config.toolPath(tool);
      if (toolPath) {
         const toolDirectory = path.dirname(toolPath);
         const currentPath = env[pathVariable];
         env[pathVariable] =
            toolDirectory +
            (currentPath ? `${pathEntrySeparator()}${currentPath}` : '');
      }
   }

   return env;
}

function pathVariableName(env: any): string {
   if (isWindows()) {
      for (const v of Object.keys(env)) {
         if (v.toLowerCase() === 'path') {
            return v;
         }
      }
   }
   return 'PATH';
}

function pathEntrySeparator() {
   return isWindows() ? ';' : ':';
}

export function safeValue(s: string): string {
   if (s.indexOf(' ') >= 0) {
      return `"${s}"`; // TODO: confirm quoting style on Mac/Linux
   }
   return s;
}
