"""Exercise the workflow's actual discovery script without publishing or deleting packages."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile


WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/nuget.publish.yml"


class PackageDiscoveryTests(unittest.TestCase):
    def test_cleanup_matrix_requires_successful_publish_and_preserves_retention(self):
        text = WORKFLOW.read_text()
        cleanup = text[text.index("  cleanup:\n"):]
        self.assertIn("needs: publish", cleanup)
        self.assertIn("!cancelled() && needs.publish.result == 'success'", cleanup)
        self.assertIn("fromJSON(needs.publish.outputs.package-names)", cleanup)
        self.assertIn("fail-fast: false", cleanup)
        self.assertIn("package-name: ${{ matrix.package-name }}", cleanup)
        self.assertIn("min-versions-to-keep: 10", cleanup)
        self.assertIn("delete-only-pre-release-versions: 'true'", cleanup)

    def discover(self, packages):
        text = WORKFLOW.read_text()
        start = text.index("          python3 <<'PY'\n") + len("          python3 <<'PY'\n")
        end = text.index("\n          PY", start)
        script = "\n".join(line[10:] for line in text[start:end].splitlines())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "Publish").mkdir()
            for filename, contents in packages.items():
                with zipfile.ZipFile(root / "Publish" / filename, "w") as package:
                    package.writestr("package.nuspec", contents)
            output = root / "output"
            result = subprocess.run(
                ["python3", "-c", script], cwd=root,
                env={**os.environ, "GITHUB_OUTPUT": str(output)},
                capture_output=True, text=True,
            )
            return result, output.read_text() if output.exists() else ""

    @staticmethod
    def nuspec(name, namespace=True):
        ns = ' xmlns="http://schemas.microsoft.com/packaging/2013/05/nuspec.xsd"' if namespace else ""
        return f"<package{ns}><metadata><id>{name}</id></metadata></package>"

    def test_discovers_all_packages_from_metadata_and_deduplicates_ids(self):
        result, output = self.discover({
            "unrelated-filename.nupkg": self.nuspec("Gainsway.Contracts"),
            "authentication.nupkg": self.nuspec("Gainsway.Authentication", namespace=False),
            "duplicate.nupkg": self.nuspec("gainsway.contracts"),
            "ignored.symbols.nupkg": "invalid XML",
            "ignored.snupkg": "invalid XML",
        })
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([name.lower() for name in json.loads(output.removeprefix("package-names="))],
                         ["gainsway.authentication", "gainsway.contracts"])

    def test_single_package_is_a_one_element_matrix(self):
        result, output = self.discover({"one.nupkg": self.nuspec("One.Package")})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(output.removeprefix("package-names=")), ["One.Package"])

    def test_empty_directory_and_invalid_metadata_fail_without_output(self):
        for packages in ({}, {"bad.nupkg": "not xml"},
                         {"missing.nupkg": "<package><metadata/></package>"},
                         {"bad-id.nupkg": self.nuspec("unexpected/package")}):
            with self.subTest(packages=packages):
                result, output = self.discover(packages)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(output, "")


if __name__ == "__main__":
    unittest.main()
