import * as htmlhandlers from "handlebars";

export function htmlHandlerRegisterHelper() {
    htmlhandlers.registerHelper("markdownHelper", markdownlinkHelper);

    htmlhandlers.registerHelper('eachProperty', (context, options) => {
        let ret = "";
        context.forEach((element: any) => {
            ret = ret + options.fn({ property: element.properties.dataset[0].table.rows, value: element.properties.metadata.name });
        });
        return ret;
    });

    htmlhandlers.registerHelper('toLowerCase', (str) => {
        return str.toLowerCase();
    });
}

function markdownlinkHelper(htmltext: string) {
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