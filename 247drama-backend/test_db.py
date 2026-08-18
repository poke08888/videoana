import pymongo
from dotenv import dotenv_values

config = dotenv_values('.env')
client = pymongo.MongoClient(config['MONGODB_URL'])
db = client.get_default_database()
video = db.shortvideos.find_one()
if video:
    print('videoImage:', video.get('videoImage'))
else:
    print('no video')
