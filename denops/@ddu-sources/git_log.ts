import type { GatherArguments } from "https://deno.land/x/ddu_vim@v3.4.4/base/source.ts";
import { fn } from "https://deno.land/x/ddu_vim@v3.4.4/deps.ts";
import { BaseSource, Item } from "https://deno.land/x/ddu_vim@v3.4.4/types.ts";
import { TextLineStream } from "https://deno.land/std@0.196.0/streams/text_line_stream.ts";
import { ChunkedStream } from "https://deno.land/x/chunked_stream@0.1.2/mod.ts";

import { ActionData } from "../@ddu-kinds/git_commit.ts";
import { ErrorStream } from "../ddu-source-git_log/message.ts";

type Params = {
  cwd?: string;
  showGraph: boolean;
  showAll: boolean;
  showReverse: boolean;
  commitOrdering: "date" | "author-date" | "topo";
};

function formatLog(): string {
  const baseFormat = [
    "", // Graph
    "%H", // Hash
    "%aN", // Author
    "%ai", // AuthorDate
    "%cN", // Commit
    "%ci", // CommitDate
    "%s", // Subject
  ];
  return baseFormat.join("%x00");
}

function parseLog(
  cwd: string,
  line: string,
  isGraph: boolean,
): Item<ActionData> {
  const [
    graph,
    hash,
    author,
    authDate,
    committer,
    commitDate,
    subject,
  ] = line.split("\x00");

  const action = {
    cwd,
    graph,
    hash,
    author,
    authDate,
    committer,
    commitDate,
    subject,
  };

  if (typeof hash === "undefined") {
    return {
      kind: "git_commit",
      word: "",
      display: `${graph}`,
      action,
    };
  }
  if (isGraph) {
    return {
      kind: "git_commit",
      word: `${hash.substring(0, 6)} ${subject} by ${author}(${committer})`,
      display: `${graph} ${hash.substring(0, 6)} ${subject}`,
      action,
    };
  }
  return {
    kind: "git_commit",
    word: `${hash.substring(0, 6)} ${subject} by ${author}(${committer})`,
    display: `${hash.substring(0, 6)} ${subject}`,
    action,
  };
}

export class Source extends BaseSource<Params, ActionData> {
  override kind = "git_commit";

  override gather({ denops, sourceParams }: GatherArguments<Params>) {
    return new ReadableStream<Item<ActionData>[]>({
      async start(controller) {
        const cwd = sourceParams.cwd ?? await fn.getcwd(denops);
        const showGraph = sourceParams.showGraph;
        const showAll = sourceParams.showAll;
        const showReverse = sourceParams.showReverse;
        const commitOrder = sourceParams.commitOrdering;
        let args: string[] = [`--${commitOrder}-order`];
        if (showGraph) args = [...args, "--graph"];
        if (showAll) args = [...args, "--all"];
        if (showReverse) args = [...args, "--reverse"];

        const { status, stderr, stdout } = new Deno.Command("git", {
          args: [
            "log",
            "--pretty=" + formatLog(),
            ...args,
          ],
          cwd,
          stdin: "null",
          stderr: "piped",
          stdout: "piped",
        }).spawn();
        status.then((stat) => {
          if (!stat.success) {
            stderr
              .pipeThrough(new TextDecoderStream())
              .pipeThrough(new TextLineStream())
              .pipeTo(new ErrorStream(denops));
          }
        });
        stdout
          .pipeThrough(new TextDecoderStream())
          .pipeThrough(new TextLineStream())
          .pipeThrough(new ChunkedStream({ chunkSize: 1000 }))
          .pipeTo(
            new WritableStream<string[]>({
              write: (logs: string[]) => {
                controller.enqueue(
                  logs.map((line) => parseLog(cwd, line, showGraph)),
                );
              },
            }),
          ).finally(() => {
            controller.close();
          });
      },
    });
  }

  override params(): Params {
    return {
      showGraph: false,
      showAll: false,
      showReverse: false,
      commitOrdering: "topo",
    };
  }
}
