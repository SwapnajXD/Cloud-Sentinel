"""Fictional demo reports must be honest, useful, and repeatable without AWS."""
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'worker'))
from demo_data import DEMO_ACCOUNT, build_demo_reports


class DemoDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reports = build_demo_reports(datetime(2026, 1, 8, tzinfo=timezone.utc))

    def test_reports_are_explicitly_fictional_and_comparable(self):
        older, latest = self.reports
        self.assertEqual(older['context'], latest['context'])
        self.assertEqual(latest['context']['account_id'], DEMO_ACCOUNT)
        self.assertTrue(all(report['demo'] and 'No AWS account was scanned' in report['assessment_note'] for report in self.reports))
        self.assertNotEqual(older['task_id'], latest['task_id'])
        self.assertTrue(latest['diff']['has_previous_scan'])
        self.assertGreater(latest['diff']['resolved_count'], 0)
        self.assertNotEqual(older['risk_score'], latest['risk_score'])

    def test_latest_report_exercises_cis_unknowns_and_evidence_linked_path(self):
        report = self.reports[-1]
        self.assertGreater(report['cis_summary']['controls_passing'], 0)
        self.assertGreater(report['cis_summary']['controls_failing'], 0)
        self.assertGreater(report['check_summary']['unknown'], 0)
        self.assertTrue(report['partial'])
        ids = {finding['id'] for finding in report['findings']}
        path = next(f['attack_path'] for f in report['findings'] if f.get('attack_path'))
        self.assertEqual(path['confidence'], 'potential')
        self.assertTrue(all(step['finding_id'] in ids for step in path['steps']))
        self.assertIn('Network ACLs', path['not_verified'])
        self.assertFalse(any(f.get('cis') for f in report['findings'] if f['category'] in ('RDS', 'Lambda')))


if __name__ == '__main__':
    unittest.main()
