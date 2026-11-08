import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/features/register.all';
import 'monaco-editor/languages/definitions/typescript/register';
import * as typescript from 'monaco-editor/languages/features/typescript/register';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import TypeScriptWorker from './editor-typescript.worker?worker';
import { LIMITS } from './runner-protocol';
import { missionCatalog, type MissionId } from './mission-catalog';

export type CodeDiagnostic = {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
};

export type CodeEditor = {
  getSource(): string;
  replaceSource(source: string): void;
  setDocument(id: MissionId, source: string): void;
  focus(): void;
  focusTodo(): void;
  layout(): void;
  getDiagnostics(): Promise<CodeDiagnostic[]>;
  compile(): Promise<CompilationResult>;
  dispose(): void;
};

export type CompilationResult =
  | { ok: true; source: string; javascript: string; diagnostics: CodeDiagnostic[] }
  | { ok: false; source: string; diagnostics: CodeDiagnostic[] };

let nextEditorId = 0;

globalThis.MonacoEnvironment = {
  getWorker(_workerId, label) {
    return label === 'typescript' || label === 'javascript'
      ? new TypeScriptWorker()
      : new EditorWorker();
  },
};

typescript.typescriptDefaults.setCompilerOptions({
  target: typescript.ScriptTarget.ES2020,
  module: typescript.ModuleKind.None,
  lib: ['lib.es2020.d.ts'],
  strict: true,
  noUnusedLocals: false,
  noUnusedParameters: false,
  noEmit: false,
  noEmitOnError: true,
  noResolve: true,
  types: [],
});
typescript.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: false,
  noSyntaxValidation: false,
  noSuggestionDiagnostics: true,
});
typescript.typescriptDefaults.addExtraLib(
  'declare const console: { log(...values: unknown[]): void };',
  'file:///aster-runtime.d.ts',
);

monaco.editor.defineTheme('aster-workbench', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'E8EDF5' },
    { token: 'comment', foreground: '8D9FB2' },
    { token: 'keyword', foreground: '8DDFE3' },
    { token: 'string', foreground: 'F2BD72' },
    { token: 'number', foreground: 'F2BD72' },
    { token: 'type.identifier', foreground: '8DDFE3' },
    { token: 'identifier', foreground: 'E8EDF5' },
    { token: 'delimiter', foreground: '8D9FB2' },
  ],
  colors: {
    'editor.background': '#0b1320',
    'editor.foreground': '#e8edf5',
    'editorLineNumber.foreground': '#8d9fb2',
    'editorLineNumber.activeForeground': '#f2bd72',
    'editorCursor.foreground': '#8ddfe3',
    'editor.selectionBackground': '#8ddfe330',
    'editor.inactiveSelectionBackground': '#8ddfe318',
    'editor.lineHighlightBackground': '#101e2e',
    'editorIndentGuide.background1': '#23364b',
    'editorIndentGuide.activeBackground1': '#8d9fb2',
    'editorBracketMatch.background': '#8ddfe318',
    'editorBracketMatch.border': '#8ddfe3',
    'editorBracketHighlight.foreground1': '#8ddfe3',
    'editorBracketHighlight.foreground2': '#f2bd72',
    'editorBracketHighlight.foreground3': '#e8edf5',
    'editorBracketHighlight.foreground4': '#8ddfe3',
    'editorBracketHighlight.foreground5': '#f2bd72',
    'editorBracketHighlight.foreground6': '#e8edf5',
    'editorWidget.background': '#101e2e',
    'editorWidget.border': '#23364b',
    'editorSuggestWidget.background': '#101e2e',
    'editorSuggestWidget.selectedBackground': '#23364b',
    'editorHoverWidget.background': '#101e2e',
    'focusBorder': '#8ddfe3',
    'input.background': '#0b1320',
    'input.foreground': '#e8edf5',
  },
});

function diagnosticMessage(message: typescript.Diagnostic['messageText']): string {
  return typeof message === 'string'
    ? message
    : [message.messageText, ...(message.next ?? []).map(diagnosticMessage)].join('\n');
}

async function withDiagnosticTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('TypeScript language service timed out. Try checking again.')), 15_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function createCodeEditor(
  container: HTMLElement,
  options: { source: string; onChange: (source: string) => void; onRun: () => void },
): Promise<CodeEditor> {
  const id = ++nextEditorId;
  const shell = document.createElement('div');
  shell.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;background:#0b1320';
  const host = document.createElement('div');
  host.style.cssText = 'flex:1;min-height:0;min-width:0';
  const hint = document.createElement('p');
  hint.id = `aster-editor-keyboard-${id}`;
  hint.className = 'editor-keyboard-hint';
  hint.textContent = 'Tab indents · Shift+Tab outdents · Ctrl+M releases Tab · Ctrl/Cmd+Enter runs';
  hint.style.cssText = 'flex:none;margin:0;padding:10px 18px;color:#aab9b9;font:13px/1.65 Manrope,system-ui,sans-serif';
  shell.append(host, hint);
  container.append(shell);

  type DocumentId = MissionId;
  const models = new Map<DocumentId, monaco.editor.ITextModel>();
  const views = new Map<DocumentId, monaco.editor.ICodeEditorViewState | null>();
  const makeModel = (documentId: DocumentId, source: string) => {
    const filename = missionCatalog[documentId].file;
    const created = monaco.editor.createModel(source, 'typescript', monaco.Uri.parse(`file:///aster-${id}/${filename}`));
    created.updateOptions({ tabSize: 2, insertSpaces: true });
    models.set(documentId, created);
    return created;
  };
  let documentId: DocumentId = 'first-light';
  let model = makeModel(documentId, options.source);
  let revision = 0;
  let disposed = false;
  const view = monaco.editor.create(host, {
    model,
    theme: 'aster-workbench',
    ariaLabel: 'TypeScript editor, route.ts',
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 15,
    lineHeight: 24,
    tabSize: 2,
    insertSpaces: true,
    detectIndentation: false,
    tabFocusMode: false,
    autoIndent: 'full',
    autoClosingBrackets: 'languageDefined',
    autoClosingQuotes: 'languageDefined',
    autoSurround: 'languageDefined',
    bracketPairColorization: { enabled: true },
    matchBrackets: 'always',
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: 'off',
    padding: { top: 18, bottom: 18 },
    contextmenu: true,
    automaticLayout: true,
    stickyScroll: { enabled: false },
    renderValidationDecorations: 'on',
    renderLineHighlight: 'line',
  });
  host.setAttribute('aria-describedby', hint.id);
  for (const input of view.getDomNode()?.querySelectorAll('textarea, .native-edit-context') ?? []) {
    input.setAttribute('aria-describedby', hint.id);
  }
  const changes = view.onDidChangeModelContent(() => { revision++; options.onChange(model.getValue()); });
  const runAction = view.addAction({
    id: 'aster.run',
    label: 'Run simulation',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
    run: () => options.onRun(),
  });
  const focusAction = view.addAction({
    id: 'aster.toggle-tab-focus',
    label: 'Toggle Tab Key Moves Focus',
    keybindings: [(navigator.platform.includes('Mac') ? monaco.KeyMod.WinCtrl : monaco.KeyMod.CtrlCmd) | monaco.KeyCode.KeyM],
    run: () => view.trigger('aster', 'editor.action.toggleTabFocusMode', null),
  });

  const check = async (emit: boolean): Promise<CompilationResult> => {
    if (disposed || model.isDisposed()) throw new Error('TypeScript editor is disposed.');
    const captured = model;
    const source = captured.getValue();
    const uri = captured.uri.toString();
    const version = captured.getVersionId();
    const capturedRevision = revision;
    const current = () => {
      if (disposed || captured.isDisposed()) throw new Error('TypeScript editor is disposed.');
      if (captured !== model || uri !== model.uri.toString() || version !== captured.getVersionId() || source !== captured.getValue() || capturedRevision !== revision) {
        throw new Error('Source changed during TypeScript checking. Run again.');
      }
    };
    if (source.length > LIMITS.sourceChars) return { ok: false, source, diagnostics: [{ line: 1, column: 1, severity: 'error', message: 'Code must be at most 65,536 characters.' }] };
    try {
      const result = await withDiagnosticTimeout((async (): Promise<CompilationResult> => {
        const getWorker = await typescript.getTypeScriptWorker();
        current();
        const worker = await getWorker(captured.uri);
        current();
        const results = await Promise.all([
          worker.getSyntacticDiagnostics(uri).then((value) => { current(); return value; }),
          worker.getSemanticDiagnostics(uri).then((value) => { current(); return value; }),
          worker.getCompilerOptionsDiagnostics(uri).then((value) => { current(); return value; }),
        ]);
        current();
        const diagnostics: CodeDiagnostic[] = results.flat().filter((item) => item.category === 0 || item.category === 1).map((item) => {
          const position = captured.getPositionAt(item.start ?? 0);
          return { line: position.lineNumber, column: position.column, message: diagnosticMessage(item.messageText), severity: item.category === 1 ? 'error' : 'warning' };
        });
        if (!emit || diagnostics.some((item) => item.severity === 'error')) return { ok: false, source, diagnostics };
        const output = await worker.getEmitOutput(uri);
        current();
        const files = output.outputFiles.filter((file) => /\.js$/.test(file.name));
        if (output.emitSkipped || files.length !== 1 || output.outputFiles.length !== 1) throw new Error('TypeScript could not emit one executable JavaScript file.');
        if (files[0].text.length > LIMITS.compiledChars) throw new Error('Compiled code exceeds 262,144 characters. Simplify your TypeScript.');
        return { ok: true, source, javascript: files[0].text, diagnostics };
      })());
      current();
      return result;
    } catch (error) {
      throw new Error(`TypeScript checking unavailable: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  };

  return {
    getSource: () => model.getValue(),
    replaceSource(source) {
      if (source === model.getValue()) return;
      view.pushUndoStop();
      view.executeEdits('aster.replace-source', [{ range: model.getFullModelRange(), text: source, forceMoveMarkers: true }]);
      view.pushUndoStop();
    },
    setDocument(nextId, source) {
      if (disposed) throw new Error('TypeScript editor is disposed.');
      if (nextId === documentId) return;
      views.set(documentId, view.saveViewState());
      const next = models.get(nextId) ?? makeModel(nextId, source);
      revision++;
      documentId = nextId;
      model = next;
      view.setModel(model);
      view.updateOptions({ ariaLabel: `TypeScript editor, ${missionCatalog[nextId].file}` });
      const saved = views.get(nextId);
      if (saved) view.restoreViewState(saved);
    },
    focus: () => view.focus(),
    focusTodo() {
      const match = model.findMatches('\\bTODO\\b', false, true, false, null, false)[0];
      const line = match?.range.startLineNumber ?? 1;
      view.setSelection(new monaco.Range(line, 1, line, model.getLineMaxColumn(line)));
      view.revealLineInCenter(line);
      view.focus();
    },
    layout: () => view.layout(),
    getDiagnostics: async () => (await check(false)).diagnostics,
    compile: () => check(true),
    dispose() {
      disposed = true;
      changes.dispose();
      runAction.dispose();
      focusAction.dispose();
      view.dispose();
      for (const item of models.values()) item.dispose();
      shell.remove();
    },
  };
}
