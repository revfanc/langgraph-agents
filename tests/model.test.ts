import assert from "node:assert/strict";
import { test } from "node:test";
import { ChatOpenAI } from "@langchain/openai";
import { createModelAgents } from "../src/agents/model.js";
import { createAgentGraph } from "../src/graph.js";

function mockModel(reply: (name: string, input: string) => unknown) {
  return new ChatOpenAI({
    model: "test-model",
    apiKey: "test-key",
    maxRetries: 0,
    useResponsesApi: false,
    configuration: {
      baseURL: "https://model.invalid/v1",
      fetch: async (url, options) => {
        assert.equal(String(url), "https://model.invalid/v1/chat/completions");
        const body = JSON.parse(String(options?.body)) as {
          tools: { function: { name: string } }[];
          messages: { role: string; content: string }[];
        };
        const name = body.tools[0]?.function.name;
        const input = body.messages.at(-1)?.content;
        assert.ok(name && input);
        assert.equal(body.messages[0]?.role, "system");
        return Response.json({
          id: "test-completion",
          object: "chat.completion",
          created: 0,
          model: "test-model",
          choices: [
            {
              index: 0,
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "test-call",
                    type: "function",
                    function: {
                      name,
                      arguments: JSON.stringify(reply(name, input)),
                    },
                  },
                ],
              },
            },
          ],
        });
      },
    },
  });
}

test("model adapter parses structured roles and carries feedback through the real graph", async () => {
  const model = mockModel((role, input) => {
    if (role === "plan") {
      assert.equal(input, "设计系统");
      return { steps: ["方案", "验收"] };
    }
    const context = JSON.parse(input) as {
      goal: string;
      plan: string[];
      draft: string;
      feedback?: string;
    };
    assert.equal(context.goal, "设计系统");
    assert.deepEqual(context.plan, ["方案", "验收"]);
    if (role === "draft")
      return {
        draft: context.feedback ? `${context.draft}；已补充验收` : "方案初稿",
      };
    assert.equal(role, "review");
    return {
      approved: context.draft.includes("已补充验收"),
      feedback: "补充验收",
    };
  });
  const result = await createAgentGraph(createModelAgents(model)).invoke({
    goal: "设计系统",
  });
  assert.equal(result.status, "approved");
  assert.equal(result.attempts, 2);
  assert.equal(result.draft, "方案初稿；已补充验收");
});

test("malformed provider output fails instead of becoming a valid plan", async () => {
  const agents = createModelAgents(mockModel(() => ({ steps: [] })));
  await assert.rejects(createAgentGraph(agents).invoke({ goal: "设计系统" }));
});
