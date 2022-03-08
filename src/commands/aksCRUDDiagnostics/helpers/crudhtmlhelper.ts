import * as htmlhandlers from "handlebars";

export function htmlHandlerRegisterHelper() {
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
