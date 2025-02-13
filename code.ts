async function getAllVariablesAndSend() {
  // Get variables by type from the current file
  const colorVars = await figma.variables.getLocalVariablesAsync("COLOR");
  const numberVars = await figma.variables.getLocalVariablesAsync("FLOAT");
  const stringVars = await figma.variables.getLocalVariablesAsync("STRING");
  const booleanVars = await figma.variables.getLocalVariablesAsync("BOOLEAN");

  // Combine them into a single array
  const allVars = [...colorVars, ...numberVars, ...stringVars, ...booleanVars];

  console.log("🔍 ALL VARIABLES:", JSON.stringify(allVars, null, 2));
  
  // Send the variables to the UI
  figma.ui.postMessage({ type: "all-variables", data: allVars });
}

// Call the function to fetch and send variables
getAllVariablesAndSend();

///

///

///

///



// Use Figma's built-in types for variables
type FigmaVariable = Variable; // Ensure we use Figma's `Variable` type
type FigmaResolvedType = "COLOR" | "STRING" | "FLOAT" | "BOOLEAN"; // Avoid redefining

// Type Guard to check if a value is a Variable Alias
function isVariableAlias(value: any): value is VariableAlias {
  return value && typeof value === "object" && value.type === "VARIABLE_ALIAS";
}

// Type Guard to check if a value is RGB or RGBA
function isRGBorRGBA(value: any): value is RGB | RGBA {
  return value && typeof value === "object" && "r" in value && "g" in value && "b" in value;
}

// Cache to prevent redundant variable resolution
const resolvedVariablesCache: Set<string> = new Set();

// Function to recursively resolve variable values
async function resolveVariableRecursive(variableId: string, consumer: SceneNode): Promise<string> {
  if (resolvedVariablesCache.has(variableId)) {
    console.log(`Skipping variable ${variableId}, already resolved.`);
    return "N/A"; // Prevent infinite loops
  }
  resolvedVariablesCache.add(variableId);

  try {
    const variable = await figma.variables.getVariableByIdAsync(variableId);
    if (!variable) {
      console.error(`Variable with ID ${variableId} not found.`);
      return "N/A";
    }

    const resolvedData = variable.resolveForConsumer(consumer);
    if (resolvedData) {
      const { value, resolvedType } = resolvedData;

      if (resolvedType === "COLOR" && isRGBorRGBA(value)) {
        const { r, g, b } = value;
        const alpha = "a" in value ? value.a : 1;
        return `rgba(${(r * 255).toFixed(0)}, ${(g * 255).toFixed(0)}, ${(b * 255).toFixed(0)}, ${alpha.toFixed(4)})`;
      } else if (resolvedType === "STRING" || resolvedType === "FLOAT" || resolvedType === "BOOLEAN") {
        return value.toString();
      } else if (isVariableAlias(value)) {
        console.log(`Resolving alias for variable ID: ${value.id}`);
        return await resolveVariableRecursive(value.id, consumer);
      }
    }

    return "N/A";
  } catch (error) {
    console.error("Error resolving variable:", error);
    return "N/A";
  }
}

// Function to scan local variables and resolve RGBA values
async function scanLocalVariables(
  collectionId?: string
): Promise<{ name: string; value: string; modes: string[]; aliasName?: string; type: string; variableCollectionId: string; rgba?: string }[]> {
  try {
    const localVariables = await figma.variables.getLocalVariablesAsync();
    const localCollections = await figma.variables.getLocalVariableCollectionsAsync();

    const collectionModes: Record<string, Record<string, string>> = {};

    localCollections.forEach((collection) => {
      collectionModes[collection.id] = {};
      collection.modes.forEach((mode) => {
        collectionModes[collection.id][mode.modeId] = mode.name;
      });
    });

    const scannedVariables: {
      name: string;
      value: string;
      modes: string[];
      aliasName?: string;
      type: string;
      variableCollectionId: string;
      rgba?: string;
    }[] = [];

    const consumer = figma.createFrame();
    consumer.resize(1, 1);
    consumer.visible = false;

    for (const variable of localVariables) {
      const { name, resolvedType, valuesByMode, variableCollectionId } = variable;

      if (!variableCollectionId) continue;

      const collection = collectionModes[variableCollectionId] || {};
      const modeEntries = await Promise.all(
        Object.entries(valuesByMode).map(async ([modeId, value]) => {
          const modeName = collection[modeId] || `Mode ${modeId}`;
          let resolvedValue = "N/A";
          let aliasName: string | undefined;
          let rgbaString: string | undefined;

          if (isVariableAlias(value)) {
            const aliasVariable = await figma.variables.getVariableByIdAsync(value.id);
            aliasName = aliasVariable ? aliasVariable.name : "Unknown Alias";
            resolvedValue = await resolveVariableRecursive(value.id, consumer);
          } else {
            // Handle different variable types
            switch (resolvedType) {
              case "COLOR":
                if (isRGBorRGBA(value)) {
                  const { r, g, b } = value;
                  const alpha = "a" in value ? value.a : 1;
                  rgbaString = `rgba(${(r * 255).toFixed(0)}, ${(g * 255).toFixed(0)}, ${(b * 255).toFixed(0)}, ${alpha.toFixed(4)})`;
                  resolvedValue = rgbaString; // Keep value same as rgba for colors
                }
                break;
              case "STRING":
                resolvedValue = `"${value}"`;
                break;
              case "FLOAT":
                resolvedValue = value.toString();
                break;
              case "BOOLEAN":
                resolvedValue = value ? "true" : "false";
                break;
              default:
                console.warn(`Unknown variable type: ${resolvedType}`);
                resolvedValue = "/* unsupported type */";
            }
          }

          return { modeName, value: resolvedValue, aliasName, rgba: rgbaString };
        })
      );

      for (const entry of modeEntries) {
        if (entry) {
          scannedVariables.push({
            name,
            value: entry.value,
            modes: [entry.modeName],
            aliasName: entry.aliasName,
            type: resolvedType,
            variableCollectionId,
            rgba: resolvedType === "COLOR" ? entry.value : "" // Always assigns a value
          });
        }
      }
    }

    consumer.remove();

    return collectionId ? scannedVariables.filter((variable) => variable.variableCollectionId === collectionId) : scannedVariables;

  } catch (error) {
    figma.ui.postMessage({
      type: "error",
      message: `Error scanning variables: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
    return [];
  }
}

// Fetch available modes
async function getAvailableModes(): Promise<{ modeId: string; modeName: string }[]> {
  try {
    const modes: { modeId: string; modeName: string }[] = [];
    const localCollections = await figma.variables.getLocalVariableCollectionsAsync();
    localCollections.forEach((collection) => {
      collection.modes.forEach((mode) => {
        modes.push({ modeId: mode.modeId, modeName: mode.name });
      });
    });
    return modes;
  } catch (error) {
    figma.ui.postMessage({
      type: "error",
      message: "Error fetching modes: " + (error instanceof Error ? error.message : "Unknown error"),
    });
    return [];
  }
}

// Fetch available collections
async function getAvailableCollections(): Promise<{ id: string; name: string }[]> {
  try {
    const localCollections = await figma.variables.getLocalVariableCollectionsAsync();
    return localCollections.map((collection) => ({
      id: collection.id,
      name: collection.name,
    }));
  } catch (error) {
    figma.ui.postMessage({
      type: "error",
      message: "Error fetching collections: " + (error instanceof Error ? error.message : "Unknown error"),
    });
    return [];
  }
}

// Handle incoming UI messages
figma.ui.onmessage = async (msg) => {
  try {
    if (msg.type === "scan-file") {
      const selectedCollectionId = msg.selectedCollectionId || null;
      const variables = await scanLocalVariables(selectedCollectionId);
      const modes = await getAvailableModes();
      figma.ui.postMessage({ type: "scan-results", variables, modes });
    } else if (msg.type === "get-collections") {
      const collections = await getAvailableCollections();
      figma.ui.postMessage({ type: "collections", collections });
    }
  } catch (error) {
    figma.ui.postMessage({
      type: "error",
      message: "Error in message handler: " + (error instanceof Error ? error.message : "Unknown error"),
    });
  }
};

// Show the UI with specified dimensions
figma.showUI(__html__, { width: 768, height: 500 });