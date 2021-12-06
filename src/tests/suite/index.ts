import * as path from 'path';
import * as Mocha from 'mocha';
import * as glob from 'glob';

export function run(): Promise<void> {
	// Create the mocha test
	const mocha = new Mocha({
		ui: 'bdd'
	});

	const testsRoot = path.resolve(__dirname);

	return new Promise((c, e) => {
		glob('**/**.test.js', { cwd: testsRoot }, (err, files) => {
			if (err) {
				return e(err);
			}

			// Add files to the test suite
			files.forEach((f) => {
				mocha.addFile(path.resolve(testsRoot, f));
				console.log(`Added file : ${f} to the test suite.`);
			});

			try {
				// Run the mocha test
				mocha.run((failures) => {
					if (failures > 0) {
						e(new Error(`${failures} tests failed.`));
					} else {
						console.log("Test passed.");
						c();
					}
				});
			} catch (err) {
				console.error(err);
				e(err);
			}
		});
	});
}