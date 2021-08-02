import { convertHtmlJsonConfiguration }  from '../../commands/detectorDiagnostics/helpers/networkconnectivityhtmlhelper';
import { expect } from 'chai';
// if you used the '@types/mocha' method to install mocha type definitions, uncomment the following line
import 'mocha';
import { AppLensARMResponse } from '../../commands/detectorDiagnostics/models/applensarmresponse';

const mockAppLensARMResponse = <AppLensARMResponse> {
    id: "test",
    location: "testlocation",
    name: "testname",
    properties: JSON.parse(`{
      "dataset": [
        {
          "renderingProperties": "",
          "description": null,
          "title": null,
          "type": 7
        }
      ]
    }`),
    type: "someTypes",
    resourceGroup: "testRG"
};

describe('Detector Diagnostic Convert HTML JSON Config function Fail case', () => {
  it('should return undefined', () => {
    const result = convertHtmlJsonConfiguration(mockAppLensARMResponse.properties, 2);
    expect(result).to.equal(undefined);
  });
});