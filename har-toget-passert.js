var Line = new Meteor.Collection("line");

var stops = [];

if (Meteor.isClient) {

  Session.set("direction", "Drammen")

  Template.train.stops = function () {
    stops = [];
    console.log("13 " + Session.get("direction"));
    var line = Line.findOne({lineNo:'L13', destination:Session.get("direction")})
    console.log(line);
    if(line !== undefined && line.stops != undefined){
      console.log("Found some stops");
      return line.stops
    }
  };

  Template.train.events({
    'change #direction' : function(event){
        console.log("Changing");
        var selectBox = document.getElementById("direction");
        var selectedDirection = selectBox.options[selectBox.selectedIndex].text;
        Session.set("direction", selectedDirection);
    }
  })

  
}

if (Meteor.isServer) {


  var callRuter = function(stop,stopid){
    console.log(stop + " - http://reis.trafikanten.no/reisrest/realtime/getrealtimedata/"+stopid);
    var returnThis;
    try {
      returnThis = HTTP.call("GET", "http://reis.trafikanten.no/reisrest/realtime/getrealtimedata/"+stopid);
    } catch(err) {
      returnThis = -1;
    }
    return returnThis;
  };

     var updateLine = function(lineNo,destination) {      
        console.log("Updating line (Start) : " + lineNo + " - " + destination);    
          var line = Line.findOne({lineNo:lineNo, destination:destination});
          var trains = [];
          var previousTrain;
          var status = "green";
          for (var i = 0; i < line.stops.length; i++) {
            var station = line.stops[i];
            var departureDate;
            var trainExpectedOnThisStop;
            if(line.stops !== undefined){
              var result = callRuter(station.stop,station.stopid);

              if(result === -1) {station.status="red"; continue;}

              var obj = JSON.parse(result.content);              
              var pTrainDate;
              for (var j = 0; j < obj.length; j++) {
                var pTrain = obj[j]
                if(pTrain.ExpectedDepartureTime !== null && pTrain.DestinationName === destination && pTrain.PublishedLineName === lineNo){
                  var d = pTrain.ExpectedDepartureTime.replace("/Date(","").replace("+0200)/","")
                  pTrainDate = new Date(parseInt(d));
                } 
                if(pTrainDate !== undefined){
                  if(departureDate === undefined || departureDate>pTrainDate){
                    departureDate=pTrainDate;   
                    trainExpectedOnThisStop = pTrain.FramedVehicleJourneyRef.DatedVehicleJourneyRef;
                  }
                }
              } 
          };

          if(departureDate !== undefined){
              var hours = departureDate.getHours()
              var minutes = departureDate.getMinutes()
              
              if (hours < 10 ){ hours= "0"+hours}
              if (minutes < 10 ){ minutes= "0"+minutes}

              if(status==="train"){
                status="green"
              }

              if(previousTrain !== undefined && previousTrain !== trainExpectedOnThisStop){
                status="train";
                station.trainid = trainExpectedOnThisStop;
              } else {
                station.trainid = '';
              }

              // Register train on line
              if(status==="train"){    
                var seenBefore = false;            
                for (var k = 0; k < line.trains.length; k++) {
                  if(line.trains[k].trainid === trainExpectedOnThisStop){
                    console.log("Train was last see on " + line.trains[k].lastSeenOn);                  
                    line.trains[k].lastSeenOn = i;
                    seenBefore=true;
                  }
                };
                if(!seenBefore){
                  console.log(line.lineNo + " is registering train " + trainExpectedOnThisStop); 
                  line.trains.push({trainid:trainExpectedOnThisStop,lastSeenOn:i});
                }
              }

              station.status = status;
              previousTrain = trainExpectedOnThisStop;
          }
          
      } 
      console.log("Updating line  (Stop) : " + lineNo + " - " + destination);
      Line.update({lineNo: lineNo, destination : destination},line);
  }

 
  var updateLines = function(){
    console.log("Updating lines");
    updateLine('L13','Drammen');
    updateLine('L13','Dal');
  }

  var trainIsOnTheStation = function(train,result){ 
    var obj = JSON.parse(result.content);              
    for (var t = 0; t < obj.length; t++) {
        if(train.trainid == obj[t].FramedVehicleJourneyRef.DatedVehicleJourneyRef){
          return true;
        }
          
    }
    return false;
  }
  
  var updateTrains = function(){
    console.log("Updating trains (start)");
    Line.find({}).forEach(function(line){
      line.trains.forEach(function(train){          
          var lastSeenStop = line.stops[train.lastSeenOn];
          var nextStop = line.stops[train.lastSeenOn+1];

          console.log(train.trainid + " - which was last seen on " + lastSeenStop.stop);

          var itIsOnTheStation = trainIsOnTheStation(train,callRuter(lastSeenStop.stop,lastSeenStop.stopid));
          if(itIsOnTheStation){
            console.log("Train is still registered at the station.")
          } else {
            console.log("Train is not registered at the station. Next train is expected.")
            var itIsOnTheNextStation = trainIsOnTheStation(train,callRuter(nextStop.stop,nextStop.stopid))            
            if(itIsOnTheNextStation) { 
              train.lastSeenOn++; 
              lastSeenStop.status="green";
              nextStop.status="train";
              Line.update({_id:line._id},line);
            }
          }
      });
    });
    console.log("Updating trains (stop)");
  }
  

  Meteor.setInterval(updateTrains, 30000);
  Meteor.setInterval(updateLines, 10 * 60000);
  Meteor.setTimeout(updateLines, 5000);

  // Stop status:
  // 0 - Not passed
  // 1 - Will be arriving
  // 2 - Previous train
  // 3 - Have passed
  // 0 and 1 must be updated.

  Meteor.startup(function () {
    Line.insert({
      'lineNo' : 'L13',
      'destination' :'Dal',
      'timestamp':'',
      'trains': [],
      'stops' : [
        {stop:'Drammen',stopid:6021000,status:'green',trainid:''},
        {stop:'Brakerøya',stopid:6029020,status:'green',trainid:''},
        {stop:'Lier',stopid:6264170,status:'green',trainid:''},
        {stop:'Asker',stopid:2200500,status:'green',trainid:''},
        {stop:'Sandvika',stopid:2190400,status:'green',trainid:''},
        {stop:'Lysaker',stopid:3012550,status:'green',trainid:''},
        {stop:'Skøyen',stopid:3012500,status:'green',trainid:''},
        {stop:'Nationaltheatret',stopid:3010030,status:'green',trainid:''},
        {stop:'Oslo S',stopid:3010010,status:'green',trainid:''},
        {stop:'Lillestrøm',stopid:2310300,status:'green',trainid:''},
        {stop:'Leirsund',stopid:2310240,status:'green',trainid:''},
        {stop:'Frogner',stopid:2260060,status:'green',trainid:''},
        {stop:'Lindeberg',stopid:2260050,status:'green',trainid:''},
        {stop:'Kløfta',stopid:2350005,status:'green',trainid:''},
        {stop:'Jessheim',stopid:2350200,status:'green',trainid:''},
        {stop:'Nordby',stopid:2350040,status:'green',trainid:''},
        {stop:'Hauerseter',stopid:2350030,status:'green',trainid:''},
        {stop:'Dal',stopid:2370600,status:'green',trainid:''}
        ]
    });

    Line.insert({
      'lineNo' : 'L13',
      'destination' :'Drammen',
      'timestamp':'',
      'trains': [],
      'stops' : [
        {stop:'Dal',stopid:2370600,status:'green',trainid:''},
        {stop:'Hauerseter',stopid:2350030,status:'green',trainid:''},
        {stop:'Nordby',stopid:2350040,status:'green',trainid:''},
        {stop:'Jessheim',stopid:2350200,status:'green',trainid:''},
        {stop:'Kløfta',stopid:2350005,status:'green',trainid:''},
        {stop:'Lindeberg',stopid:2260050,status:'green',trainid:''},
        {stop:'Frogner',stopid:2260060,status:'green',trainid:''},
        {stop:'Leirsund',stopid:2310240,status:'green',trainid:''},
        {stop:'Lillestrøm',stopid:2310300,status:'green',trainid:''},
        {stop:'Oslo S',stopid:3010010,status:'green',trainid:''},
        {stop:'Nationaltheatret',stopid:3010030,status:'green',trainid:''},
        {stop:'Skøyen',stopid:3012500,status:'green',trainid:''},
        {stop:'Lysaker',stopid:3012550,status:'green',trainid:''},
        {stop:'Sandvika',stopid:2190400,status:'green',trainid:''},
        {stop:'Asker',stopid:2200500,status:'green',trainid:''},
        {stop:'Lier',stopid:6264170,status:'green',trainid:''},
        {stop:'Brakerøya',stopid:6029020,status:'green',trainid:''},
        {stop:'Drammen',stopid:6021000,status:'green',trainid:''}
      ]
    });
});

}
