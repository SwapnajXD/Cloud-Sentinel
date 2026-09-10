import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('reset_owner_password', Path(__file__).resolve().parents[1] / 'scripts/reset_owner_password.py')
reset = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reset)


class PasswordResetTests(unittest.TestCase):
    def test_password_is_sent_over_stdin_and_never_as_command_argument(self):
        password = 'new-test-password-123'
        with patch.object(reset.getpass, 'getpass', side_effect=[password, password]), \
             patch.object(reset.subprocess, 'run', return_value=Mock(returncode=0)) as run:
            self.assertEqual(reset.main(['TEST@example.com']), 0)
        command = run.call_args.args[0]
        self.assertNotIn(password, ' '.join(command))
        self.assertEqual(command[-5:-2], ['-T', 'gateway', 'node'])
        self.assertEqual(json.loads(run.call_args.kwargs['input']), {'email': 'test@example.com', 'password': password})

    def test_sudo_authentication_happens_separately_from_password_transfer(self):
        with patch.object(reset.getpass, 'getpass', return_value='new-test-password-123'), \
             patch.object(reset.subprocess, 'run', return_value=Mock(returncode=0)) as run:
            self.assertEqual(reset.main(['--sudo', 'test@example.com']), 0)
        self.assertEqual(run.call_args_list[0].args[0], ['sudo', '-v'])
        self.assertEqual(run.call_args_list[1].args[0][:3], ['sudo', '-n', 'docker'])

    def test_invalid_or_mismatched_password_never_reaches_database(self):
        for inputs in [('one-password-123', 'different-password'), ('short', 'short'), ('é' * 40, 'é' * 40)]:
            with self.subTest(inputs=inputs), patch.object(reset.getpass, 'getpass', side_effect=inputs), \
                 patch.object(reset.subprocess, 'run') as run, patch('sys.stderr'):
                self.assertEqual(reset.main(['test@example.com']), 1)
                run.assert_not_called()

    def test_non_private_prompt_is_rejected(self):
        with patch.object(reset.getpass, 'getpass', side_effect=reset.getpass.GetPassWarning), \
             patch.object(reset.subprocess, 'run') as run, patch('sys.stderr'):
            self.assertEqual(reset.main(['test@example.com']), 1)
            run.assert_not_called()

    def test_failed_container_command_returns_failure(self):
        with patch.object(reset.getpass, 'getpass', return_value='new-test-password-123'), \
             patch.object(reset.subprocess, 'run', return_value=Mock(returncode=1)):
            self.assertEqual(reset.main(['test@example.com']), 1)
