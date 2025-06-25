'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import documentService from '@/lib/services/documents.service';
import studentService from '@/lib/services/student.service';
import { DocumentAnalysis, Student } from '@/lib/schemas/types';

function ReviewCard({ analysis, types, refresh }: {
  analysis: DocumentAnalysis;
  types: Array<{ _id: string; name: string }>;
  refresh: () => void;
}) {
  const document = typeof analysis.document === 'string' ? null : analysis.document;
  const [studentQuery, setStudentQuery] = useState('');
  const [studentId, setStudentId] = useState('');
  const [documentType, setDocumentType] = useState(analysis.documentType || '');
  const [busy, setBusy] = useState(false);
  const { data: students = [] } = useQuery({
    queryKey: ['review-students', studentQuery],
    queryFn: () => studentService.getAllStudents({ search: studentQuery }),
    enabled: studentQuery.trim().length >= 2,
  });

  const save = async () => {
    setBusy(true);
    try {
      await documentService.review(document?._id || String(analysis.document), {
        ...(studentId ? { studentId } : {}),
        ...(documentType ? { documentType } : {}),
      });
      toast.success('Review saved');
      refresh();
    } catch {
      toast.error('Unable to save review');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded border bg-white p-4 space-y-3">
      <div className="flex justify-between gap-4">
        <div>
          <strong>{document?.documentName || 'Document'}</strong>
          <p className="text-sm">Processing: {analysis.status} · Student: {analysis.matchStatus}
            {analysis.matricNumber ? ` · Matric: ${analysis.matricNumber}` : ''}</p>
          {analysis.error && <p className="text-red-700" role="alert">{analysis.error}</p>}
        </div>
        {document?._id && <a className="underline" href={`/dashboard/documents/${document._id}`}>Open</a>}
      </div>
      {analysis.pages?.[0]?.text && <p className="max-h-24 overflow-auto text-sm">{analysis.pages[0].text.slice(0, 500)}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="block text-sm" htmlFor={`student-query-${analysis._id}`}>Find student</label>
          <input id={`student-query-${analysis._id}`} className="w-full rounded border p-2"
            value={studentQuery} onChange={(event) => setStudentQuery(event.target.value)}
            placeholder="Name or matriculation number" />
          <select className="mt-2 w-full rounded border p-2" value={studentId}
            onChange={(event) => setStudentId(event.target.value)} aria-label="Matched student">
            <option value="">Choose a student</option>
            {(students as Student[]).map((student) => <option key={student._id} value={student._id}>
              {student.matricNumber} · {student.user?.firstName} {student.user?.lastName}
            </option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm" htmlFor={`type-${analysis._id}`}>Document type</label>
          <select id={`type-${analysis._id}`} className="w-full rounded border p-2"
            value={documentType} onChange={(event) => setDocumentType(event.target.value)}>
            <option value="">Choose a type</option>
            {types.map((type) => <option key={type._id} value={type.name}>{type.name}</option>)}
          </select>
        </div>
      </div>
      <button className="rounded bg-purple-700 px-4 py-2 text-white disabled:opacity-50"
        disabled={busy || (!studentId && !documentType)} onClick={save}>Save review</button>
    </article>
  );
}

export default function DocumentReviewPage() {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [newType, setNewType] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: queue = [] } = useQuery({ queryKey: ['document-review'], queryFn: documentService.getReviewQueue,
    refetchInterval: 10000 });
  const { data: types = [] } = useQuery({ queryKey: ['document-types'], queryFn: documentService.getTypes });
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['document-review'] }); };

  const importFiles = async () => {
    if (!files.length) return;
    setBusy(true);
    try {
      await documentService.importScans(files);
      toast.success(`${files.length} file(s) queued`);
      setFiles([]);
      refresh();
    } catch { toast.error('Import failed'); }
    finally { setBusy(false); }
  };

  return <main className="space-y-8 py-6">
    <header><h1 className="text-2xl font-semibold">Document import and review</h1>
      <p>Scans are analyzed in the background. Ambiguous student matches and document types appear here.</p></header>
    <section className="rounded border bg-white p-5 space-y-3">
      <h2 className="text-lg font-semibold">Import paper records</h2>
      <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff"
        onChange={(event) => setFiles(Array.from(event.target.files || []))} />
      <div className="flex gap-3">
        <button className="rounded bg-purple-700 px-4 py-2 text-white disabled:opacity-50"
          disabled={busy || !files.length} onClick={importFiles}>Import scans</button>
        <button className="rounded border px-4 py-2" onClick={async () => {
          const result = await documentService.backfill();
          toast.success(`${result.data.queued} existing document(s) queued`);
          refresh();
        }}>Process existing documents</button>
      </div>
    </section>
    <section className="rounded border bg-white p-5 space-y-3">
      <h2 className="text-lg font-semibold">School document types</h2>
      <p className="text-sm">{types.map((type) => type.name).join(', ') || 'No types configured yet.'}</p>
      <div className="flex gap-2"><input className="rounded border p-2" value={newType}
        onChange={(event) => setNewType(event.target.value)} placeholder="e.g. Bursary clearance form" />
        <button className="rounded border px-4" onClick={async () => {
          if (!newType.trim()) return;
          await documentService.createType(newType);
          setNewType('');
          void queryClient.invalidateQueries({ queryKey: ['document-types'] });
        }}>Add type</button></div>
    </section>
    <section className="space-y-4"><h2 className="text-lg font-semibold">Review queue</h2>
      {queue.length === 0 && <p>No documents need review.</p>}
      {queue.map((analysis) => <ReviewCard key={analysis._id} analysis={analysis}
        types={types} refresh={refresh} />)}
    </section>
  </main>;
}
