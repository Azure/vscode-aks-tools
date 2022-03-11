import { AppLensARMResponse } from '../../utils/detectors';

export function convertHtmlJsonConfiguration(
  webviewClusterData: AppLensARMResponse["properties"],
  datasetIndex: number
): any {
  // ARM call returns html embed in json and at times some index values are not guranteed.
  if (webviewClusterData.dataset.length >= datasetIndex) {
    const htmlRawDataArray = webviewClusterData.dataset[datasetIndex].table?.rows;

    const htmlJsonDataSet = {
      subnet: {
        subnetClass: htmlRawDataArray[0][0].toString().toLowerCase(),
        subnetDataset: htmlRawDataArray
      }
    };
    return htmlJsonDataSet;
  }

  return undefined;
}
