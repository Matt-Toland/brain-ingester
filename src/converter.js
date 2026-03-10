/**
 * Convert ProseMirror JSON (Granola notes.content) to Markdown.
 * Handles the common node types Granola uses.
 */

export function prosemirrorToMarkdown(doc) {
  if (!doc || !doc.content) return '';
  return convertNodes(doc.content).trim();
}

function convertNodes(nodes, context = {}) {
  if (!Array.isArray(nodes)) return '';
  return nodes.map(node => convertNode(node, context)).join('');
}

function convertNode(node, context = {}) {
  switch (node.type) {
    case 'doc':
      return convertNodes(node.content, context);

    case 'paragraph':
      return convertInline(node.content) + '\n\n';

    case 'heading': {
      const level = node.attrs?.level || 1;
      const prefix = '#'.repeat(level);
      return `${prefix} ${convertInline(node.content)}\n\n`;
    }

    case 'bulletList':
    case 'bullet_list':
      return convertListItems(node.content, '- ', context) + '\n';

    case 'orderedList':
    case 'ordered_list': {
      let idx = node.attrs?.start || 1;
      return convertListItems(node.content, () => `${idx++}. `, context) + '\n';
    }

    case 'listItem':
    case 'list_item': {
      const prefix = typeof context.prefix === 'function' ? context.prefix() : (context.prefix || '- ');
      const indent = context.indent || '';
      const inner = convertNodes(node.content, { ...context, indent: indent + '  ' })
        .replace(/\n\n$/, '\n');
      // Indent continuation lines
      const lines = inner.split('\n');
      const formatted = lines
        .map((line, i) => i === 0 ? `${indent}${prefix}${line}` : (line ? `${indent}  ${line}` : ''))
        .join('\n');
      return formatted + '\n';
    }

    case 'blockquote':
      return convertNodes(node.content)
        .split('\n')
        .map(line => line ? `> ${line}` : '>')
        .join('\n') + '\n\n';

    case 'codeBlock':
    case 'code_block': {
      const lang = node.attrs?.language || '';
      const code = convertInline(node.content);
      return `\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
    }

    case 'horizontalRule':
    case 'horizontal_rule':
      return '---\n\n';

    case 'hardBreak':
    case 'hard_break':
      return '\n';

    case 'text':
      return applyMarks(node.text || '', node.marks);

    case 'image': {
      const alt = node.attrs?.alt || '';
      const src = node.attrs?.src || '';
      return `![${alt}](${src})\n\n`;
    }

    case 'taskList':
    case 'task_list':
      return convertNodes(node.content, context) + '\n';

    case 'taskItem':
    case 'task_item': {
      const checked = node.attrs?.checked ? 'x' : ' ';
      const indent = context.indent || '';
      const inner = convertNodes(node.content).replace(/\n\n$/, '');
      return `${indent}- [${checked}] ${inner}\n`;
    }

    case 'table':
      return convertTable(node) + '\n';

    default:
      // Fallback: try to convert children
      if (node.content) return convertNodes(node.content, context);
      if (node.text) return applyMarks(node.text, node.marks);
      return '';
  }
}

function convertListItems(items, prefix, context) {
  if (!Array.isArray(items)) return '';
  return items
    .map(item => convertNode(item, { ...context, prefix }))
    .join('');
}

function convertInline(nodes) {
  if (!Array.isArray(nodes)) return '';
  return nodes.map(node => {
    if (node.type === 'text') return applyMarks(node.text || '', node.marks);
    if (node.type === 'hardBreak' || node.type === 'hard_break') return '\n';
    if (node.type === 'image') return `![${node.attrs?.alt || ''}](${node.attrs?.src || ''})`;
    if (node.content) return convertInline(node.content);
    return node.text || '';
  }).join('');
}

function applyMarks(text, marks) {
  if (!marks || !Array.isArray(marks)) return text;
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
      case 'strong':
        text = `**${text}**`;
        break;
      case 'italic':
      case 'em':
        text = `*${text}*`;
        break;
      case 'code':
        text = `\`${text}\``;
        break;
      case 'strike':
      case 'strikethrough':
        text = `~~${text}~~`;
        break;
      case 'link':
        text = `[${text}](${mark.attrs?.href || ''})`;
        break;
      case 'underline':
        text = `<u>${text}</u>`;
        break;
    }
  }
  return text;
}

function convertTable(node) {
  if (!node.content) return '';
  const rows = node.content.filter(r => r.type === 'tableRow' || r.type === 'table_row');
  if (rows.length === 0) return '';

  const tableData = rows.map(row =>
    (row.content || []).map(cell => convertInline(cell.content).replace(/\n/g, ' ').trim())
  );

  if (tableData.length === 0) return '';

  const colCount = Math.max(...tableData.map(r => r.length));
  const colWidths = Array.from({ length: colCount }, (_, i) =>
    Math.max(3, ...tableData.map(r => (r[i] || '').length))
  );

  const formatRow = cells =>
    '| ' + Array.from({ length: colCount }, (_, i) =>
      (cells[i] || '').padEnd(colWidths[i])
    ).join(' | ') + ' |';

  const separator = '| ' + colWidths.map(w => '-'.repeat(w)).join(' | ') + ' |';

  const lines = [formatRow(tableData[0]), separator];
  for (let i = 1; i < tableData.length; i++) {
    lines.push(formatRow(tableData[i]));
  }

  return lines.join('\n') + '\n';
}

/**
 * Build a complete markdown document for a meeting.
 * Matches the exact format the downstream Brain pipeline expects:
 *
 * # {Title}
 * **Creator:** {name} ({email})
 * **Date:** {ISO timestamp}
 * **Meeting Link:** {granola URL}
 * **Attendees:** {attendee list}
 *
 * ## Enhanced Notes
 * {ProseMirror notes converted to markdown}
 *
 * ---
 * Chat with meeting transcript: [{link}]({link})
 *
 * ## Full Transcript
 * {raw transcript utterances}
 */
export function buildMeetingMarkdown(doc, transcript) {
  const parts = [];

  // Title
  const title = doc.title || 'Untitled Meeting';
  parts.push(`# ${title}`);

  // Creator
  const creator = doc.people?.creator;
  if (creator) {
    const name = creator.name || creator.details?.person?.name?.fullName || 'Unknown';
    const email = creator.email || '';
    parts.push(`**Creator:** ${name}${email ? ` (${email})` : ''}`);
  }

  // Date
  if (doc.created_at) {
    parts.push(`**Date:** ${doc.created_at}`);
  }

  // Calendar event title (if available from google_calendar_event)
  if (doc.google_calendar_event?.summary) {
    parts.push(`**Calendar Event Title:** ${doc.google_calendar_event.summary}`);
  }
  if (doc.google_calendar_event?.id) {
    parts.push(`**Calendar Event ID:** ${doc.google_calendar_event.id}`);
  }

  // Meeting link
  if (doc.has_shareable_link !== false && doc.id) {
    const meetingLink = `https://notes.granola.ai/d/${doc.id}`;
    parts.push(`**Meeting Link:** ${meetingLink}`);
  }

  // Attendees
  const attendees = doc.people?.attendees;
  if (attendees && attendees.length > 0) {
    const attendeeLines = attendees.map(a => {
      const lines = [];
      if (a.email) lines.push(`email: ${a.email}`);
      if (a.name) lines.push(`name: ${a.name}`);
      return lines.join('\n');
    }).join('\n');
    parts.push(`**Attendees:** ${attendeeLines}`);
  }

  // File created timestamp
  parts.push(`**File Created Timestamp:** ${Math.floor(Date.now() / 1000)}`);

  // Source identifier (replaces Zapier Step ID)
  parts.push(`**Source ID:** ${doc.id}`);

  parts.push('');

  // Enhanced Notes (ProseMirror → Markdown)
  if (doc.notes?.content) {
    parts.push('## Enhanced Notes');
    const notes = prosemirrorToMarkdown(doc.notes);
    if (notes.trim()) {
      parts.push(notes);
    }
  } else if (doc.notes_markdown) {
    parts.push('## Enhanced Notes');
    parts.push(doc.notes_markdown);
  }

  // Separator + transcript link
  parts.push('---\n');
  if (doc.id) {
    const transcriptLink = `https://notes.granola.ai/t/${doc.id}`;
    parts.push(`Chat with meeting transcript: [${transcriptLink}](${transcriptLink})`);
  }

  // Full Transcript (raw utterances)
  if (Array.isArray(transcript) && transcript.length > 0) {
    parts.push('\n## Full Transcript\n');
    for (const utterance of transcript) {
      const speaker = utterance.source === 'microphone' ? 'Me' : 'Them';
      const text = utterance.text || '';
      if (text.trim()) {
        parts.push(`${speaker}: ${text}  `);
      }
    }
  }

  return parts.join('\n').trim() + '\n';
}
