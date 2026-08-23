import { ProjectIndex } from "./ProjectIndex.js";
import { ProjectWorkspace } from "./ProjectWorkspace.js";
import {
  useProjectsPageController,
  type ProjectsPageProps,
} from "./useProjectsPageController.js";

export function ProjectsPage(props: ProjectsPageProps) {
  const controller = useProjectsPageController(props);

  return controller.projectId ? (
    <ProjectWorkspace controller={controller} />
  ) : (
    <ProjectIndex controller={controller} />
  );
}
