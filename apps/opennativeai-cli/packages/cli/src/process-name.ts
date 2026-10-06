export const CLI_COMMAND_NAME = "opennativeai";
export const CLI_PROCESS_NAME = "opennativeai-cli";

interface ProcessTitleTarget {
  title: string;
}

export const setCliProcessTitle = (
  target: ProcessTitleTarget = process,
): void => {
  target.title = CLI_PROCESS_NAME;
};
