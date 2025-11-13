import React from "react";
import type { ModalProps } from "@mantine/core";
import { Modal, Stack, Text, ScrollArea, Flex, CloseButton, Button, Textarea, TextInput, Group } from "@mantine/core";
import { CodeHighlight } from "@mantine/code-highlight";
import type { NodeData } from "../../../types/graph";
import useGraph from "../../editor/views/GraphView/stores/useGraph";
import useJson from "../../../store/useJson";
import useFile from "../../../store/useFile";

// return object from json removing array and object fields
const normalizeNodeData = (nodeRows: NodeData["text"]) => {
  if (!nodeRows || nodeRows.length === 0) return "{}";
  if (nodeRows.length === 1 && !nodeRows[0].key) {
    // single primitive value
    const v = nodeRows[0].value;
    try {
      return JSON.stringify(v);
    } catch (e) {
      return `${v}`;
    }
  }

  const obj: Record<string, unknown> = {};
  nodeRows?.forEach(row => {
    if (row.type !== "array" && row.type !== "object") {
      if (row.key) obj[row.key] = row.value;
    }
  });
  return JSON.stringify(obj, null, 2);
};

// return json path in the format $["customer"]
const jsonPathToString = (path?: NodeData["path"]) => {
  if (!path || path.length === 0) return "$";
  const segments = path.map(seg => (typeof seg === "number" ? seg : `"${seg}"`));
  return `$[${segments.join("][")}]`;
};

export const NodeModal = ({ opened, onClose }: ModalProps) => {
  const nodeData = useGraph(state => state.selectedNode);
  const getJson = useJson(state => state.getJson);
  const setJson = useJson(state => state.setJson);
  const setContents = useFile(state => state.setContents);

  const [editing, setEditing] = React.useState(false);
  const [editText, setEditText] = React.useState("");
  const [fields, setFields] = React.useState<Array<{ key: string | null; value: string; type: string }>>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!nodeData) return;
    setEditing(false);
    setError(null);
    setEditText(normalizeNodeData(nodeData?.text ?? []));

    // prepare editable fields (only primitive rows)
    const prims = (nodeData?.text ?? []).filter(r => r.type !== "array" && r.type !== "object");
    if (prims.length === 0) {
      setFields([]);
    } else if (prims.length === 1 && !prims[0].key) {
      setFields([{ key: null, value: String(prims[0].value ?? ""), type: prims[0].type }]);
    } else {
      setFields(prims.map(r => ({ key: r.key ?? null, value: String(r.value ?? ""), type: r.type })));
    }
  }, [nodeData, opened]);

  const closeAndReset = () => {
    setEditing(false);
    setError(null);
    onClose?.();
  };

  // helper to apply edits at path
  const applyEdit = (rawJson: string, path: NodeData["path"] | undefined, newValue: unknown) => {
    const root = JSON.parse(rawJson);

    if (!path || path.length === 0) {
      // editing root
      return JSON.stringify(newValue, null, 2);
    }

    const parentPath = path.slice(0, -1);
    const last = path[path.length - 1] as string | number;

    let parent: any = root;
    for (const seg of parentPath) {
      parent = parent[seg as any];
    }

    // If parent is undefined, throw
    if (typeof parent === "undefined") throw new Error("Invalid path");

    // Set based on last
    parent[last as any] = newValue;

    return JSON.stringify(root, null, 2);
  };

  const handleSave = () => {
    setError(null);
    if (!nodeData) return;

    try {
      const currentJson = getJson();

      // Determine what kind of node content we have
      const hasKeys = nodeData.text.some(r => r.key !== null);

      if (hasKeys) {
        // Use fields instead of raw JSON editing
        // Build an object from fields
        const updatedObj: Record<string, any> = {};
        fields.forEach(f => {
          if (!f.key) return;
          // parse based on original type
          let val: any = f.value;
          if (f.type === "number") {
            const n = Number(f.value);
            val = Number.isNaN(n) ? f.value : n;
          } else if (f.type === "boolean") {
            const low = f.value.toLowerCase();
            val = low === "true" ? true : low === "false" ? false : f.value;
          } else if (f.type === "null") {
            val = null;
          }
          updatedObj[f.key] = val;
        });

        const root = JSON.parse(currentJson);
        // navigate to target
        let target: any = root;
        if (nodeData.path && nodeData.path.length > 0) {
          for (const seg of nodeData.path) target = target[seg as any];
        }

        if (typeof target !== "object" || target === null) {
          // replace direct value
          const updated = applyEdit(currentJson, nodeData.path, updatedObj);
          setContents({ contents: updated, hasChanges: true });
          closeAndReset();
          return;
        }

        // modify primitive keys on target: remove primitive keys not present in fields, set ones present
        const keysToDelete: string[] = [];
        Object.keys(target).forEach(k => {
          const val = target[k];
          if (val === null || typeof val !== "object") {
            if (!fields.some(f => f.key === k)) keysToDelete.push(k);
          }
        });

        keysToDelete.forEach(k => delete target[k]);
        Object.keys(updatedObj).forEach(k => (target[k] = updatedObj[k]));

        const jsonStr = JSON.stringify(root, null, 2);
        setContents({ contents: jsonStr, hasChanges: true });
        closeAndReset();
        return;
      }

      // single primitive value
      let parsedValue: any = null;
      try {
        parsedValue = JSON.parse(editText);
      } catch (e) {
        // treat as raw string
        parsedValue = editText;
      }

      const updated = applyEdit(currentJson, nodeData.path, parsedValue);
      setContents({ contents: updated, hasChanges: true });
      closeAndReset();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

    const updateField = (index: number, patch: Partial<{ key: string | null; value: string; type: string }>) => {
      setFields(prev => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
    };

    const addField = () => setFields(prev => [...prev, { key: `key${prev.length + 1}`, value: "", type: "string" }]);

    const removeField = (index: number) => setFields(prev => prev.filter((_, i) => i !== index));

  return (
    <Modal size="auto" opened={opened} onClose={onClose} centered withCloseButton={false}>
      <Stack pb="sm" gap="sm">
        <Stack gap="xs">
          <Flex justify="space-between" align="center">
            <Text fz="xs" fw={500}>
              Content
            </Text>
            <Flex gap="xs" align="center">
              {!editing && (
                <Button size="xs" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
              {editing && (
                <>
                  <Button size="xs" color="gray" variant="outline" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                  <Button size="xs" onClick={handleSave}>
                    Save
                  </Button>
                </>
              )}
              <CloseButton onClick={closeAndReset} />
            </Flex>
          </Flex>

          <ScrollArea.Autosize mah={350} maw={600}>
            {!editing ? (
              <CodeHighlight
                code={normalizeNodeData(nodeData?.text ?? [])}
                miw={350}
                maw={600}
                language="json"
                withCopyButton
              />
            ) : (
              <div>
                {fields && fields.length > 0 ? (
                  <Stack gap="xs">
                    {fields.map((f, i) =>
                      f.key === null ? (
                        <TextInput
                          key={`val-${i}`}
                          label="Value"
                          value={f.value}
                          onChange={e => updateField(i, { value: e.currentTarget.value })}
                        />
                      ) : (
                        <Group key={`${String(f.key)}-${i}`} align="flex-start">
                          <TextInput
                            style={{ flex: 1 }}
                            label="key"
                            value={f.key ?? ""}
                            onChange={e => updateField(i, { key: e.currentTarget.value })}
                            placeholder="key"
                          />
                          <TextInput
                            style={{ flex: 2 }}
                            label="value"
                            value={f.value}
                            onChange={e => updateField(i, { value: e.currentTarget.value })}
                          />
                          <Button size="xs" color="gray" variant="outline" onClick={() => removeField(i)}>
                            Remove
                          </Button>
                        </Group>
                      )
                    )}
                    <Group>
                      <Button size="xs" variant="subtle" onClick={addField}>
                        Add field
                      </Button>
                    </Group>
                  </Stack>
                ) : (
                  <Textarea
                    minRows={6}
                    maxRows={20}
                    value={editText}
                    onChange={e => setEditText(e.currentTarget.value)}
                  />
                )}
              </div>
            )}
          </ScrollArea.Autosize>
        </Stack>
        <Text fz="xs" fw={500}>
          JSON Path
        </Text>
        <ScrollArea.Autosize maw={600}>
          <CodeHighlight
            code={jsonPathToString(nodeData?.path)}
            miw={350}
            mah={250}
            language="json"
            copyLabel="Copy to clipboard"
            copiedLabel="Copied to clipboard"
            withCopyButton
          />
        </ScrollArea.Autosize>
        {error && (
          <Text color="red" fz="xs">
            {error}
          </Text>
        )}
      </Stack>
    </Modal>
  );
};
