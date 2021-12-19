import * as networkconnectivityhelper  from '../../commands/detectorDiagnostics/helpers/networkconnectivityhtmlhelper';
import { expect } from 'chai';
import 'sinon';
import { AppLensARMResponse } from '../../commands/detectorDiagnostics/models/applensarmresponse';
import sinon = require('sinon');

describe('Detector Diagnostic Convert HTML JSON Config function Fail case', () => {
  it('should return undefined', () => {
    const result = networkconnectivityhelper.convertHtmlJsonConfiguration(mockAppLensARMResponse.properties, 2);
    expect(result).to.equal(undefined);
  });
});
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

describe("Detector Diagnostic Pass Case", () => {
  it('should return some value', () => {
    const stub = sinon.stub(networkconnectivityhelper, 'convertHtmlJsonConfiguration').returns("some value");
    const result = networkconnectivityhelper.convertHtmlJsonConfiguration(mockAppLensARMResponse.properties, 2);

    expect(result).to.equal("some value");
    expect(stub.callCount).to.equal(1);
  });
});