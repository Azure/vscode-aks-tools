import { Command } from "./messaging";

export module TestStyleViewerTypes {
    export const contentId = "style";

    export interface InitialState {
        isVSCode: boolean
    }

    export interface ReportCssVars extends Command<"reportCssVars"> {
        cssVars: string[]
    }

    export interface ReportCssRules extends Command<"reportCssRules"> {
        rules: CssRule[]
    }

    export interface CssRule {
        selector: string,
        text: string
    }

    export type ToVsCodeCommands = ReportCssVars | ReportCssRules;
    export type ToWebViewCommands = never;
}
