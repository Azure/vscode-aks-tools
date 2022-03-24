import * as configureStarterWorkflow  from '../../commands/aksStarterWorkflow/configureStarterWorkflowHelper';
import 'sinon';
import { expect } from 'chai';
import { Succeeded, succeeded } from '../../commands/utils/errorable';

describe('Test Configure Starter Data Set returns replaced value.', () => {
  it('should return some string', () => {
    const result = configureStarterWorkflow.configureStarterConfigDataForAKS("test-resource", "test-cluster");
    expect(succeeded(result)).to.be.true;
    expect((result as Succeeded<string>).result).to.contain("test-cluster");
  });
});
