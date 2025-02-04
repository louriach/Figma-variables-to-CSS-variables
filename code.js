"use strict";
// Type Guard to check if the value is a Variable Alias
function isVariableAlias(value) {
    return value && typeof value === "object" && value.type === "VARIABLE_ALIAS";
}
// Type Guard to check if the value is RGB or RGBA
function isRGBorRGBA(value) {
    return value && typeof value === "object" && "r" in value && "g" in value && "b" in value;
}
// Cache to keep track of already resolved variables to avoid circular references or re-resolution
const resolvedVariablesCache = new Set();
// Function to resolve variable values recursively
async function resolveVariableRecursive(variableId, consumer) {
    if (resolvedVariablesCache.has(variableId)) {
        console.log(`Skipping variable ${variableId}, already resolved.`);
        return "N/A"; // Return early if already resolved
    }
    resolvedVariablesCache.add(variableId); // Mark the variable as resolved
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
            }
            else if (resolvedType === "STRING" || resolvedType === "FLOAT" || resolvedType === "BOOLEAN") {
                return value.toString();
            }
            else if (isVariableAlias(value)) {
                console.log(`Resolving alias for variable ID: ${value.id}`);
                // Resolve the alias recursively
                return await resolveVariableRecursive(value.id, consumer);
            }
        }
        return "N/A";
    }
    catch (error) {
        console.error("Error resolving variable:", error);
        return "N/A";
    }
}
// Function to scan local variables and output their resolved RGBA values
async function scanLocalVariables(collectionId) {
    try {
        const localVariables = await figma.variables.getLocalVariablesAsync();
        const localCollections = await figma.variables.getLocalVariableCollectionsAsync();
        const collectionModes = {};
        localCollections.forEach((collection) => {
            collectionModes[collection.id] = {};
            collection.modes.forEach((mode) => {
                collectionModes[collection.id][mode.modeId] = mode.name;
            });
        });
        const colorVariables = [];
        const consumer = figma.createFrame();
        consumer.resize(1, 1);
        consumer.visible = false;
        for (const variable of localVariables) {
            const { name, resolvedType, valuesByMode, variableCollectionId } = variable;
            if (resolvedType === "COLOR" && variableCollectionId) {
                const collection = collectionModes[variableCollectionId] || {};
                const modeEntries = await Promise.all(Object.entries(valuesByMode).map(async ([modeId, value]) => {
                    const modeName = collection[modeId] || `Mode ${modeId}`;
                    let rgbaString = "N/A";
                    let aliasName = undefined;
                    if (isVariableAlias(value)) {
                        // Resolve alias and its value
                        const aliasVariable = await figma.variables.getVariableByIdAsync(value.id);
                        aliasName = aliasVariable ? aliasVariable.name : "Unknown Alias"; // Traditional check
                        rgbaString = await resolveVariableRecursive(value.id, consumer);
                    }
                    else if (isRGBorRGBA(value)) {
                        // Handle RGB/RGBA directly
                        const { r, g, b } = value;
                        const alpha = "a" in value ? value.a : 1;
                        rgbaString = `rgba(${(r * 255).toFixed(0)}, ${(g * 255).toFixed(0)}, ${(b * 255).toFixed(0)}, ${alpha.toFixed(4)})`;
                    }
                    return { modeName, rgba: rgbaString, aliasName };
                }));
                for (const entry of modeEntries) {
                    if (entry) {
                        colorVariables.push({
                            name,
                            rgba: entry.rgba,
                            modes: [entry.modeName],
                            aliasName: entry.aliasName,
                            variableCollectionId,
                        });
                    }
                }
            }
        }
        consumer.remove();
        if (collectionId) {
            return colorVariables.filter((variable) => variable.variableCollectionId === collectionId);
        }
        return colorVariables;
    }
    catch (error) {
        figma.ui.postMessage({
            type: "error",
            message: `Error scanning variables: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
        return [];
    }
}
// Function to fetch available modes
async function getAvailableModes() {
    try {
        const modes = [];
        const localCollections = await figma.variables.getLocalVariableCollectionsAsync();
        localCollections.forEach(collection => {
            collection.modes.forEach(mode => {
                modes.push({ modeId: mode.modeId, modeName: mode.name });
            });
        });
        return modes;
    }
    catch (error) {
        figma.ui.postMessage({ type: "error", message: "Error fetching modes: " + (error instanceof Error ? error.message : 'Unknown error') });
        return [];
    }
}
// Function to fetch available collections
async function getAvailableCollections() {
    try {
        const localCollections = await figma.variables.getLocalVariableCollectionsAsync();
        return localCollections.map(collection => ({
            id: collection.id,
            name: collection.name,
        }));
    }
    catch (error) {
        figma.ui.postMessage({ type: "error", message: "Error fetching collections: " + (error instanceof Error ? error.message : 'Unknown error') });
        return [];
    }
}
// Function to handle incoming UI messages
figma.ui.onmessage = async (msg) => {
    try {
        if (msg.type === "scan-file") {
            const selectedCollectionId = msg.selectedCollectionId || null;
            const variables = await scanLocalVariables(selectedCollectionId);
            const modes = await getAvailableModes();
            figma.ui.postMessage({ type: "scan-results", variables, modes });
        }
        if (msg.type === "get-collections") {
            const collections = await getAvailableCollections();
            figma.ui.postMessage({ type: "collections", collections });
        }
    }
    catch (error) {
        figma.ui.postMessage({
            type: "error",
            message: "Error in message handler: " + (error instanceof Error ? error.message : "Unknown error"),
        });
    }
};
// Show the UI with specified dimensions
figma.showUI(__html__, { width: 768, height: 500 });
