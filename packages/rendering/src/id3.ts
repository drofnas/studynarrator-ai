import NodeID3 from "node-id3";

export function writeFinalMp3Metadata(options: {
  path: string;
  title: string;
  year: number;
}): void {
  try {
    const result = NodeID3.update(
      {
        title: options.title,
        artist: "Study Narrator AI",
        year: String(options.year),
        genre: "Audio Book",
      },
      options.path,
    );
    if (result instanceof Error) throw result;
  } catch {
    throw new Error("Final MP3 metadata could not be written.");
  }
}
