import * as fs from 'fs';
import * as htmlhandlers from "handlebars";
import { HelperDelegate } from 'handlebars';
import * as path from 'path';
import * as vscode from 'vscode';

export enum HtmlHelper {
    None = 0,
    MarkdownLinkHelper = 1 << 0,
    EachProperty = 1 << 1,
    ToLowerCase = 1 << 2,
    EqualsZero = 1 << 3,
    IsNonZeroNumber = 1 << 4,
    BreakLines = 1 << 5
}

interface HelperDefinition {
    helper: HtmlHelper,
    name: string,
    delegate: HelperDelegate
}

const helperDefinitions: HelperDefinition[] = [
    {
        helper: HtmlHelper.MarkdownLinkHelper,
        name: 'markdownHelper',
        delegate: (htmltext: string) => {
            // Change git style pretty link [txt](link) to html anchor <a> style.
            // e.g. [text](link) becomes <a href="link">text</a>
            const re = /\[(.*?)\)/g;
            let replacedHtmlText = htmltext;
            let match;
            replacedHtmlText = replacedHtmlText.split("\n").join("<br/>");
    
            while (match = re.exec(htmltext)) {
                const matchstr = `[${match[1]})`;
                const linkurl = `<a href='${match[1].split('](')[1]}'>${match[1].split('](')[0]}</a>`;
                replacedHtmlText = replacedHtmlText.replace(matchstr, linkurl);
            }
    
            return replacedHtmlText;
        }
    },
    {
        helper: HtmlHelper.EachProperty,
        name: 'eachProperty',
        delegate: (context, options) => {
            let ret = "";
            context.forEach((element: any) => {
                ret = ret + options.fn({ property: element.properties.dataset[0].table.rows, value: element.properties.metadata.name });
            });
            return ret;
        }
    },
    {
        helper: HtmlHelper.ToLowerCase,
        name: 'toLowerCase',
        delegate: str => str.toLowerCase()
    },
    {
        helper: HtmlHelper.EqualsZero,
        name: 'equalsZero',
        delegate: (value: number): boolean => value === 0
    },
    {
        helper: HtmlHelper.IsNonZeroNumber,
        name: 'isNonZeroNumber',
        delegate: (value: any): boolean => {
            if (isNaN(Number(value))) {
                return false;
            }
            return value !== 0;
        }
    },
    {
        helper: HtmlHelper.BreakLines,
        name: 'breaklines',
        delegate: (text: any): any => {
            if (text) {
                text = text.replace(/(\r\n|\n|\r)/gm, '<br>');
            }
            return text;
        }
    }
]

export function createWebView(viewType: string, title: string): vscode.Webview {
    const panel = vscode.window.createWebviewPanel(
        viewType,
        title,
        vscode.ViewColumn.Active,
        {
            enableScripts: true,
            enableCommandUris: true
        }
    );

    return panel.webview;
}

export function getResourceUri(vscodeExtensionPath: string, folder: string, filename: string): vscode.Uri {
    return vscode.Uri
        .file(path.join(vscodeExtensionPath, 'resources', 'webviews', folder, filename))
        .with({ scheme: 'vscode-resource' });
}

export function getRenderedContent(templateUri: vscode.Uri, data: object, requiredHelpers: HtmlHelper): string {
    const templateContent = fs.readFileSync(templateUri.fsPath, 'utf8').toString();

    // Only register the specified helpers
    for (const defn of helperDefinitions) {
        if (defn.helper === (requiredHelpers & defn.helper)) {
            htmlhandlers.registerHelper(defn.name, defn.delegate);
        }
    }

    const template = htmlhandlers.compile(templateContent);
    return template(data);
}
