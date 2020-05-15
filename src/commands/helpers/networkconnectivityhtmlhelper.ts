import { AppLensARMresponse } from '../models/applensarmresponse';
import * as htmlhandlers from "handlebars";

export default class NetworkConnectivityHtmlHelper {

    static convertHtmlJsonConfiguration(
        webviewClusterData: AppLensARMresponse["properties"],
        datasetIndex: number
        ): string {
          const htmlRawDataArray = webviewClusterData.dataset[datasetIndex].table.rows;

          const htmlJsonDataSet = {
                subnet: {
                  subnetClass: htmlRawDataArray[0][0].toString().toLowerCase(),
                  subnetDataset: htmlRawDataArray
                }
              };

          return JSON.stringify(htmlJsonDataSet);
        }

      static htmlHandlerRegisterHelper() {
        htmlhandlers.registerHelper("generatehtml", this.generateHyperlinkHelper);
      }

      static generateHyperlinkHelper(htmltext: string) {
        // Change git style pretty link [txt](link) to html anchor <a> style.
        // e.g. [text](link) becomes <a href="link">text</a>
        const re = /\[(.*?)\)/g;
          let replacedHtmlText = htmltext;
          let match;
          replacedHtmlText = replacedHtmlText.split("\n").join("<br/>");

          while (match = re.exec(htmltext)) {
            const matchstr = `[${match[1]})`;
            const linkurl =  `<a href='${match[1].split('](')[1]}'>${match[1].split('](')[0]}</a>`;
            replacedHtmlText = replacedHtmlText.replace(matchstr, linkurl);
          }
          return replacedHtmlText;
      }
}
