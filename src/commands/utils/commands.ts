import { Observable } from 'rxjs';
import { Disposable } from 'vscode';

export class OutputStream extends Disposable {
    constructor(
        dispose: () => void,
        readonly lines: Observable<string>) {
        super(dispose);
    }
}
