import sys,json,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from NLP.generative import generate_response
class Response:
 def __init__(self,records):self.records=records
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def __iter__(self):return iter(json.dumps(r).encode()+b'\n' for r in self.records)
class GenerativeTests(unittest.TestCase):
 def test_stream_and_history_contract(self):
  records=[{'message':{'content':'Hello '}},{'message':{'content':'Sam'},'done':True}]
  with patch('NLP.generative.urllib.request.urlopen',return_value=Response(records)) as call:
   self.assertEqual(''.join(generate_response('What is my name?',[{'role':'user','content':'My name is Sam'}])),'Hello Sam')
   payload=json.loads(call.call_args.args[0].data);self.assertFalse(payload['think']);self.assertTrue(payload['stream']);self.assertEqual(payload['messages'][-2]['content'],'My name is Sam')
 def test_interrupted_or_empty_response_is_an_error(self):
  for records in [[{'message':{'content':'Partial'}}],[{'message':{'content':''},'done':True}]]:
   with patch('NLP.generative.urllib.request.urlopen',return_value=Response(records)):
    with self.assertRaises(RuntimeError):''.join(generate_response('Hello'))
if __name__=='__main__':unittest.main()
