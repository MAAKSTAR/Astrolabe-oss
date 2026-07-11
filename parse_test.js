let streamingText = '';
const parts = [
  '<thought>This is reasoning.</thought>\nHello there!',
  '<thought>More reasoning',
  '</thought> More text'
];

let finalReasoning = '';
let finalResponse = '';

for (const part of parts) {
  // how to parse streaming XML incrementally?
}
