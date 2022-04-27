import * as fs from 'fs';
import * as htmlhandlers from "handlebars";
import * as path from 'path';
import * as vscode from 'vscode';

//
// Register the custom HTML handlers. Having these registered the first time the module is imported means
// they are registered one time, rather than each time they are used.
//

htmlhandlers.registerHelper('markdownHelper', (htmltext: string) => {
    // Change git style pretty link [txt](link) to html anchor <a> style.
    // e.g. [text](link) becomes <a href="link">text</a>
    const re = /\[(.*?)\)/g;
    let replacedHtmlText = htmltext;
    let match;
    replacedHtmlText = replacedHtmlText?.split("\n").join("<br/>");

    while (match = re.exec(htmltext)) {
        const matchstr = `[${match[1]})`;
        const linkurl = `<a href='${match[1].split('](')[1]}'>${match[1].split('](')[0]}</a>`;
        replacedHtmlText = replacedHtmlText.replace(matchstr, linkurl);
    }

    return replacedHtmlText;
});

htmlhandlers.registerHelper('eachProperty', (context, options) => {
    let ret = "";
    context.forEach((element: any) => {
        ret = ret + options.fn({ property: element.properties.dataset[0].table.rows, value: element.properties.metadata.name });
    });
    return ret;
});

htmlhandlers.registerHelper('toLowerCase', str => str.toLowerCase());

htmlhandlers.registerHelper('equalsZero', (value: number): boolean => value === 0);

htmlhandlers.registerHelper('isNonZeroNumber', (value: any): boolean => {
    if (isNaN(Number(value))) {
        return false;
    }
    return value !== 0;
});

htmlhandlers.registerHelper('breaklines', (text: any): any => {
    if (text) {
        text = text.replace(/(\r\n|\n|\r)/gm, '<br>');
    }
    return text;
});

htmlhandlers.registerHelper('ifEquals', (originalValue, valueToCompare) => {
    return (originalValue === valueToCompare);
});

htmlhandlers.registerHelper('isNotGarbage', (originalValue) => {
    return (originalValue && originalValue.toLowerCase() !== "test");
});

htmlhandlers.registerHelper("setStyleVar", (varValue) => {
        const styleString = `style="background-color: ${varValue}; width: 20px; height: 50px;"`;
        return styleString;
});

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

export function getRenderedContent(templateUri: vscode.Uri, data: object): string {
    const templateContent = fs.readFileSync(templateUri.fsPath, 'utf8').toString();

    const template = htmlhandlers.compile(templateContent);
    return template(data);
}
