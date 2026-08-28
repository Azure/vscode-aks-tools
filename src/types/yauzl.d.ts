/**
 * Minimal ambient types for `yauzl`, which ships no types of its own.
 *
 * Declared locally rather than depending on `@types/yauzl` so this extension
 * adds no new packages to the dependency tree. Only the surface actually used
 * by `binaryDownloadHelper.ts` is described here — extend it if more of the
 * API is needed.
 *
 * Upstream API reference: https://github.com/thejoshwolfe/yauzl#api
 */
declare module "yauzl" {
    import { Readable } from "stream";

    /** A single entry in the zip's central directory. */
    export interface Entry {
        /** Always '/'-separated, per the zip specification. */
        fileName: string;
        uncompressedSize: number;
        compressedSize: number;
    }

    export interface ZipFile {
        /** Emits the next entry; only meaningful with `lazyEntries: true`. */
        on(event: "entry", listener: (entry: Entry) => void): this;
        /** All entries have been read. */
        on(event: "end", listener: () => void): this;
        on(event: "error", listener: (error: Error) => void): this;
        /** Requests the next entry. Required when `lazyEntries` is set. */
        readEntry(): void;
        openReadStream(entry: Entry, callback: (error: Error | null, stream?: Readable) => void): void;
        close(): void;
    }

    export interface OpenOptions {
        /**
         * When true, entries are emitted one at a time in response to
         * `readEntry()` rather than all at once.
         */
        lazyEntries?: boolean;
        autoClose?: boolean;
        decodeStrings?: boolean;
        validateEntrySizes?: boolean;
    }

    export function open(
        path: string,
        options: OpenOptions,
        callback: (error: Error | null, zipFile?: ZipFile) => void,
    ): void;
}
